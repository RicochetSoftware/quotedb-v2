# Production infrastructure

QuoteDB runs entirely on **one DigitalOcean Droplet**: API, PostgreSQL 17, and Caddy serving
`site`, `web`, and `admin`. Cloudflare supplies DNS and the R2 infrastructure-state bucket;
there are no Cloudflare Pages projects or managed database services.

Defaults: `quotes.elmu.dev`, Frankfurt (`fra1`), Ubuntu 24.04, `s-1vcpu-1gb` (1 vCPU, 1 GB RAM,
25 GB disk). DigitalOcean's API listed this plan at **$6/month** on 1 Nov 2026, before tax,
optional backups, or usage beyond included allowances. Images are built in CI, never on the Droplet.

| Path | Purpose |
|---|---|
| `terraform/` | OpenTofu root: backend module, all four hosts' A/AAAA records, extra mail DNS records |
| `terraform/modules/digitalocean-backend/` | Droplet, cloud firewall, generated secrets, cloud-init |
| `droplet/` | Production Compose, deploy/release, database backup, and operations checks |
| `docker/api.Dockerfile` | API image pushed to GHCR |
| `docker/static.Dockerfile` | All three frontend builds packaged in Caddy, pushed to GHCR |
| `selfhost/` | Same application stack built locally for another VPS or a local production-like run |

```
quotes.elmu.dev         ─┐
app.quotes.elmu.dev      ├─ A/AAAA → Droplet → Caddy :80/:443
admin.quotes.elmu.dev    │                    ├─ static site / web / admin
api.quotes.elmu.dev     ─┘                    └─ API :8080 → PostgreSQL :5432
```

Only Caddy publishes container ports. PostgreSQL is reachable inside Docker or through SSH.
DNS records are **DNS-only**, so Caddy obtains certificates for all four hosts, including nested
subdomains, without depending on Cloudflare's Universal SSL coverage.

## Initial setup

1. Authenticate `doctl auth init`. OpenTofu separately reads `DIGITALOCEAN_TOKEN`.
2. Create an SSH deployment key pair and include its public key plus your administrator public
   key in `ssh_public_keys`. CI uses the private key as `DEPLOY_SSH_KEY`.
3. Create a Cloudflare API token with DNS edit access to the **elmu.dev** zone.
4. Create a private R2 bucket named `quotedb-tfstate` and an Object Read & Write token for it.
   The access key ID and secret go in `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`.
5. Generate and save a state-encryption passphrase (`openssl rand -base64 32`). Losing this
   passphrase or the state loses access to the generated database password and pinned SSH key.
6. Verify the sending domain with Resend and supply `TF_VAR_resend_api_key`. Put the actual
   verification records in `extra_dns_records`.

Copy `.env.deploy.example` to `.env.deploy` in this directory, restrict it with `chmod 600`,
and fill in the credentials locally. It is gitignored. From the repository root:

```bash
set -a
source infra/.env.deploy
set +a
cd infra/terraform
cp backend.hcl.example backend.hcl  # replace <CLOUDFLARE_ACCOUNT_ID>
# Optional: copy terraform.tfvars.example to terraform.tfvars for nonsecret overrides.
tofu init -backend-config=backend.hcl
tofu plan
```

### Adopt the existing DNS records before applying

The domain previously served a retired deployment. Inspect all four hostnames in
Cloudflare before applying: import existing A and AAAA records into the addresses below so
OpenTofu updates them instead of creating duplicate answers. If a hostname currently has a
CNAME, remove that obsolete CNAME during cutover before creating A/AAAA records. Do not leave
old A or AAAA answers alongside the new addresses. Leave unrelated zone records alone.

```bash
# Repeat for existing records: keys are site, web, admin, api.
tofu import 'cloudflare_dns_record.app["site"]' '<ZONE_ID>/<EXISTING_A_RECORD_ID>'
tofu import 'cloudflare_dns_record.app_ipv6["site"]' '<ZONE_ID>/<EXISTING_AAAA_RECORD_ID>'
tofu plan
# Review the plan, then provision the Droplet and update DNS:
tofu apply
```

If an earlier UpCloud deployment actually exists in state, migrate its data and retire its
resources separately before applying this configuration. There are no automatic state moves
between the two providers. A provider/module switch is not a database migration.

## Deploy

`.github/workflows/deploy.yml` builds the API and static images in GitHub Actions, pushes both
to GHCR, applies infrastructure, and deploys both images together over pinned-host-key SSH.
It runs on pushes to `master`, manually, and weekly to refresh base images. PRs validate and
plan infrastructure. Production workflows are serialized across the entire release.

Secrets:
`DIGITALOCEAN_TOKEN`, `CLOUDFLARE_API_TOKEN`, `RESEND_API_KEY`, `TOFU_STATE_PASSPHRASE`,
`R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `DEPLOY_SSH_KEY`.

Variables:
`DOMAIN=quotes.elmu.dev`, `CLOUDFLARE_ACCOUNT_ID` (R2), `CLOUDFLARE_ZONE_ID`,
`SSH_PUBLIC_KEYS` (JSON array). Optional: `DIGITALOCEAN_REGION=fra1`,
`DROPLET_SIZE=s-1vcpu-1gb`, `DROPLET_BACKUPS=false`, `IZARO_USER_ID`.
Keep CI variables consistent with local tfvars: CI does not read gitignored files.

Manual deployment, after building and pushing the two images from a workstation:

```bash
umask 077
tofu -chdir=infra/terraform output -raw api_ssh_known_hosts > /tmp/qdb-known-hosts
tofu -chdir=infra/terraform output -raw api_env_file > /tmp/qdb-api.env
tofu -chdir=infra/terraform output -raw postgres_env_file > /tmp/qdb-postgres.env
REGISTRY_USER=<github-user> REGISTRY_TOKEN=<token-with-read-packages> \
  infra/droplet/deploy.sh \
  "$(tofu -chdir=infra/terraform output -raw api_ssh_target)" \
  ghcr.io/<owner>/<repo>/api:<tag> ghcr.io/<owner>/<repo>/static:<tag> \
  quotes.elmu.dev /tmp/qdb-api.env /tmp/qdb-postgres.env /tmp/qdb-known-hosts
unlink /tmp/qdb-api.env
unlink /tmp/qdb-postgres.env
```

Build the static image with `--build-arg DOMAIN=quotes.elmu.dev`; its API URLs are baked into
the browser bundles. Both images must target `linux/amd64`.

A release waits for cloud-init, uploads files into a private staging directory, takes a remote
lock, pulls images sequentially, starts PostgreSQL, takes a dump, runs migrations, and then
replaces API/Caddy containers. A migration failure leaves the old application containers
running, though schema changes may already have occurred. It checks HTTPS for all four hosts.
Registry credentials are isolated to staging and removed when the release finishes.

For an application rollback, run the workflow with **both** `api_image` and `static_image`
from the desired release. This does not roll back database schema or data; use compatible
migrations or restore a database backup during maintenance.

## Database backups and recovery

A systemd timer runs `droplet/backup.sh` daily at 03:00 UTC, and deployments take an additional
pre-migration dump. Dumps are `pg_dump -Fc` archives under `/opt/quotedb/backups`, mode 600,
retained for seven days. Archive listing is checked before marking a dump complete. The daily
operations check flags missing/stale backups or an inactive timer.

**These dumps are on the same disk as PostgreSQL. They do not survive loss of the Droplet.**
Copy them to separate storage before using the deployment for irreplaceable data. For example,
using the same pinned SSH settings as deployment:

```bash
ssh -o UserKnownHostsFile=/tmp/qdb-known-hosts -o StrictHostKeyChecking=yes deploy@<IP> \
  /opt/quotedb/backup.sh
scp -o UserKnownHostsFile=/tmp/qdb-known-hosts -o StrictHostKeyChecking=yes \
  'deploy@<IP>:/opt/quotedb/backups/quotedb-*.dump' ./secure-backups/
```

Optional DigitalOcean system backups can be enabled with `droplet_backups=true` (or the CI
variable `DROPLET_BACKUPS=true`). They cost extra; weekly backups are currently 20% of the
Droplet price ([DigitalOcean pricing](https://docs.digitalocean.com/products/backups/details/pricing/)).
They complement logical dumps and do not replace testing a restore.

Restore an archive onto an initialized stack during maintenance, after copying it to the server:

```bash
cd /opt/quotedb
docker compose stop api caddy
docker compose exec -T postgres pg_restore -U quotedb -d quotedb \
  --clean --if-exists --no-owner --exit-on-error < /path/to/quotedb.dump
# Run the target application's migrations, then resume traffic.
docker compose run --rm --no-deps api node dist/migrate.js
docker compose up -d --wait
```

Test recovery into a disposable database before replacing production data. Do not use
`docker compose down -v`, prune volumes, regenerate the password resource, or recreate the
Droplet as a routine upgrade. PostgreSQL only applies `POSTGRES_PASSWORD` when initializing
an empty volume; password rotation requires an SQL password change as well as updating state.

## Upkeep and capacity

- A 2 GB swap file provides temporary headroom on the 1 GB host. Compose limits PostgreSQL to
  256 MB, API to 320 MB, and Caddy to 128 MB resident memory; swap limits add some burst capacity.
  This is a starting budget for the small workload, not a load-tested capacity guarantee.
- PostgreSQL uses 64 MB shared buffers and 30 connections. Node has a 192 MB old-space limit.
- Security/regular OS updates run unattended, with automatic reboots at 04:00 UTC. Reboots
  briefly take all services offline. Containers restart automatically.
- The cloud firewall and UFW allow SSH, HTTP, HTTPS, and HTTP/3; SSH is key-only for `deploy`.
- Daily `ops-check.yml` checks updates, reboots, disk, containers, and backups. Public health
  checks run every 15 minutes. Read GitHub's failed-workflow notifications.
- Docker rotates logs and releases prune unused images older than a week, never volumes.
- `prevent_destroy` guards the Droplet. Cloud-init changes are ignored after creation; apply
  OS/config/key changes over SSH or use a planned backup/restore migration. The guard does not
  protect deletions outside OpenTofu or removal of the resource block itself.
- A Postgres major upgrade requires an explicit dump/restore or `pg_upgrade`, not just changing
  the image tag. For OS replacements, restore data onto a new server and verify before cutover.

## Verification

Run `tofu fmt -check -recursive`, `tofu validate`, and `tofu test` in `terraform/`. The tests
mock every provider and make no cloud changes. They check DNS routing, matching database
credentials, small-Droplet bootstrap, and firewall exposure. CI runs them before applying.
Shell scripts pass ShellCheck, and deployment workflows pass actionlint.

The production images and memory limits were smoke-tested locally: migrations, all four HTTPS
hosts, SPA fallback, static 404s, PostgreSQL restart persistence, and dump/restore into a separate
database. This is functional verification, not a sustained production load test.

## Self-host locally

```bash
cd infra/selfhost
cp .env.example .env
docker compose up -d --build
```

Use `DOMAIN=localhost` for `https://app.localhost` and the other local hosts (Caddy's local CA).
Production uses the prebuilt-image stack in `droplet/`.
