# QuoteDB observability

Public status: https://status.quotes.elmu.dev
Private dashboard: https://whitemayfly2546.grafana.net/d/quotedb-performance

## Ownership and deployment

OpenTofu in `infra/terraform` owns D1, the dedicated Access application/policy/token,
origin/heartbeat/operator secrets and the Worker custom domain. Its existing R2
state encryption is mandatory. Set `status_monitoring_enabled=true`; set
`status_domain_enabled=true` only after `quotedb-status` exists. `prevent_destroy`
protects the database while its configuration is present. Never apply an older
checkout that lacks the status resources against this state. Merge this change
before the next regular application infrastructure deployment.

Wrangler owns Worker code, D1 bindings and schedules. There are six entrypoints:

- `quotedb-probes-frontend` and `quotedb-probes-backend`: independent one-minute
  Web/Site and API/Admin probe pairs. Each atomically replaces only newer samples.
- `quotedb-status-exporter`: bounded one-minute delivery retries, isolated from probes
  and public snapshots.
- `quotedb-monitor`: one-minute state evaluations, authenticated heartbeat/operator
  ingestion. No public route; only the public Worker's service binding reaches it.
- `quotedb-status-maintenance`: its own one-minute cron for public snapshots,
  30-minute history summaries and retention. It has no
  public route. A service binding does **not** provide an independent top-level CPU
  allowance; this separate cron keeps cleanup/export out of the check invocation.
- `quotedb-status`: static assets plus a sanitized API reading one snapshot row.
  Only `/heartbeat` and `/operator` POSTs are forwarded to the monitor. Neither
  these routes nor `/api/status` serve application data or database credentials.

The application release must not deploy/reset the Workers or their measurements.
`.github/workflows/status-deploy.yml` independently typechecks, tests, applies
additive D1 migrations and deploys compatible code. Configure repository variables
`STATUS_ENABLED=true` and `STATUS_DATABASE_ID` after provisioning. Existing account,
zone, domain, Access and deployment secrets are reused. The application workflow
reads heartbeat credentials from encrypted state and `OBSERVABILITY_ENV` from
GitHub's secret store. Worker secrets persist between code deployments.

For a manual status release, from `apps/status` with the correct account token:

```sh
export STATUS_DATABASE_ID="$(cd ../../infra/terraform && tofu output -raw status_database_id)"
node scripts/configure.mjs
pnpm exec wrangler d1 migrations apply quotedb-status --remote --config wrangler.monitor.generated.json
pnpm exec wrangler deploy --config wrangler.frontend.generated.json
pnpm exec wrangler deploy --config wrangler.backend.generated.json
pnpm exec wrangler deploy --config wrangler.monitor.generated.json
pnpm exec wrangler deploy --config wrangler.public.generated.json
pnpm exec wrangler deploy --config wrangler.maintenance.generated.json
pnpm exec wrangler deploy --config wrangler.exporter.generated.json
```

Generated configuration is ignored by Git. The zero UUID in source is local-only.
Wrangler must not also own a `routes` entry for the OpenTofu custom domain. Check
TLS for **status.quotes.elmu.dev** itself; the apex wildcard does not cover it.
Cron propagation can take up to 15 minutes. Until observations arrive, unknown is
expected. Never seed production with fixture history to make it green.

## Credentials and private collection

`tofu output -json status_secrets` contains `BOT_SECRET`, `OPERATOR_SECRET`,
`ADMIN_MONITOR_SECRET`, `ACCESS_CLIENT_ID` and `ACCESS_CLIENT_SECRET`. Write it to a
mode-600 temporary file for `wrangler secret bulk`, never stdout in CI. The backend probe Worker needs the three Access/origin credentials. The monitor
also needs `OTLP_URL` to enable its outbox. The exporter Worker needs `OTLP_URL`
and `OTLP_AUTH` (`Basic base64(stack-id:metrics-write-token)`). The current stack ID
is 1901810, Prometheus tenant 3727839, region `prod-eu-north-0`. Only `metrics:write`
is needed; do not use the interactive gcx credential for ingestion.

Optional `ALERT_URL` and `ALERT_AUTH` enable a generic transition webhook. The
receiver **must** honor `Idempotency-Key` / the payload's `id`: network timeouts
make exactly-once delivery impossible otherwise. Transitions are grouped per
minute; raw application errors/content are never included. Delivery retries six
times with bounded exponential backoff. Transition alerts keep FIFO priority;
current metric gauges precede old backfill after an export outage. Failed deliveries log only category and
attempt. Disabled notification delivery never prevents deployment or monitoring.

Rotate bot secrets by setting `BOT_SECRET_PREVIOUS`, installing the new
`BOT_SECRET` on the monitor and bot, verifying receipt, then removing the old
secret. Boot IDs are retained to reject retired-boot replays; freshness always uses
server receipt time. Rotate the Access token before its one-year expiry, updating
both the expected origin client identity and probe headers together.

Alloy runs as UID/GID 473 with 128 MiB memory, 192 MiB memory+swap and 0.25 CPU caps;
`GOMEMLIMIT=96MiB`. Its named WAL volume is owned by this UID. The config is mode
644 and contains **no** secrets; `observability.env` is mode 600. There are no
published ports and no Docker socket in the collector. API and bot metrics listen
on Docker-only port 9091 when `METRICS_ENABLED=true`. The bot's readiness listener
remains loopback-only on 8090. A root-owned one-minute systemd task exports only
fixed service names, container memory and restart counts through a textfile.

Before enabling the Compose override, create a dedicated PostgreSQL LOGIN role
`quotedb_monitor` with `GRANT pg_monitor TO quotedb_monitor`, using a generated
password. Put its URL in `POSTGRES_MONITOR_DSN`; never use the application owner.
Install `config.alloy`, `compose.observability.yaml` and `observability.env` in the
Compose directory. Add the override to `COMPOSE_FILE`. `deploy.sh` accepts
`OBSERVABILITY_ENV_FILE`; subsequent releases preserve an enabled collector and
install the container-metrics timer. Provision the monitor role again after a
fresh database restore, if the role is absent. PostgreSQL roles are cluster-level.

`provision-grafana.sh` validates/pushes the QuoteDB folder/dashboard and upserts
stable diagnostic alert UIDs. It does not change notification destinations. The live QuoteDB email contact point
and project-scoped routing policy were configured separately with the operator’s
authorized email destination; Grafana accepted a test email. Review
Grafana contact points and notification policies: an empty receiver means rules
are visible in Grafana but **no email/chat is sent**. The blackbox check runs from
the Droplet, checks HTTPS status plus `"stale":false`, and reports to Grafana outside
Cloudflare. Its rule also detects missing collector data. GitHub `ops-check` adds
another independent endpoint/freshness check with the existing failed-run emails.
The public incident engine remains the source of application availability episodes.

No logs, traces, Faro, quote text, identifiers or request URLs are exported. HTTP
metric labels use registered route templates, fixed method names and status
classes. Bot metrics use fixed interaction kinds/outcomes. Empty command latency
panels mean there have been no observed interactions, not zero latency.

## Operational commands

`pnpm --filter @quotedb/status operator operation.json` reads
`STATUS_OPERATOR_SECRET` from the environment. The default destination is the
production hostname; `STATUS_URL` can select a preview. Idempotency IDs are supplied
by the operator. Notes are public, plain text, at most 500 characters.

```json
{"kind":"maintenance","id":"deploy-20261109","component":"api","start":1794225600000,"end":1794227400000,"note":"Scheduled API maintenance"}
```

`start`/`end` are epoch **milliseconds**; windows must start no earlier than now
(minus a minute for clock skew), last at most seven days, and name one of `web`,
`admin`, `bot`, `api`, `site`. Submit one operation per affected component.

```json
{"kind":"note","id":"incident-note-1","incident":"api-12345","note":"Recovery is being verified."}
```

`{"kind":"refresh"}` rebuilds the public snapshot. It
runs no probes, creates no observations, and cannot manufacture freshness.

### Automatic deployment and reboot maintenance

When `STATUS_ENABLED=true`, CI supplies a private `status-maintenance.json` containing
only the operator URL and secret. The release preserves this file for manual releases
and registers a ten-minute window for all five components after image pulls and
before replacing any running service. Registration failure aborts the release before
services are interrupted. Manual `deploy.sh` invocations can supply the same JSON via
`STATUS_MAINTENANCE_FILE`; once installed, subsequent releases reuse it.

The release also installs `quotedb-reboot.timer`, which checks at 04:00 UTC for
`/var/run/reboot-required`. It takes the deployment lock, registers the same bounded
window, then reboots. It replaces unattended-upgrades' direct reboot via an APT
override; package updates remain automatic. No reboot needed means no maintenance
window. Registration failure skips the reboot and fails the service; ops-check reports
that failure. The timer does not catch up missed runs after boot. Unscheduled manual
reboots still need an operator window (or use the maintenance helper before rebooting).

Windows expire automatically after ten minutes even if deployment or recovery fails;
failures after expiry count as downtime. Healthy time within a window is also excluded
from uptime. A partially failed registration may leave a window for the components
already registered, but does not interrupt services. Existing history is unchanged.

## State, history and outages

Checks have fixed HTTPS destinations, no redirects, a shared five-second deadline
per component, bounded bodies, and two concurrent requests per probe Worker. The evaluator uses samples at most
90 seconds old, never counts the same probe twice, and reports stopped probe
Workers as unknown. Independent cron ordering can add one evaluation interval
to confirmation. This split is necessary for the per-invocation Free CPU budget. Web and
Site verify their shell and a referenced build asset. API checks `/healthz` plus
`/api/v1/public/izaro`, validating and discarding the response. Removing the
configured featured content deliberately makes this representative check fail.
Admin verifies its dedicated Access JWT audience, exact service identity and origin
secret, then checks PostgreSQL and the actual admin shell/asset through internal
Caddy port 8091. It does not test a human OTP sign-in.

Two consecutive failures confirm down. Three slow successes among five successful
samples confirm degradation (HTTP 1500 ms; gateway 500 ms). Three fully healthy
samples recover; sustained successful slow responses can recover red to yellow.
An unresolved incident survives gaps and maintenance. The latest observation is
unknown after 180 seconds. Missing gateway latency is unknown, never zero.

Raw observations count toward uptime even before incident confirmation. Intervals
end at the next observation, capped at 180 seconds and split at UTC midnight.
Successful slow time is available and separately degraded. Unknown/maintenance
are excluded from the denominator with coverage shown. There is no fabricated
pre-monitoring history. 24 hours is rolling; 30/90 days are UTC calendar windows
including today. History summaries update every 30 minutes; daily totals include
bounded current observations. Public snapshots update independently each minute.

D1 batches compare the previous generation and reject duplicate/older evaluations.
Raw checks last 14 days, daily rollups 400 days, episodes/events at least 366 days.
Pruning is indexed, bounded and repeatable. Retired boot IDs persist for replay
protection. On D1/quota failures, the static shell still loads and the API returns
503 or a timestamped stale snapshot. Missing telemetry never resolves incidents.
Grafana failure leaves measurements/incidents in D1 and retries in the outbox.

## Budget and validation

Before launch this account had no other Workers/crons and only the new D1 database.
Production uses all five free cron slots. Nominal daily requests are 7200 scheduled
runs, 2880 heartbeats and 1440 independent status probes: 11,520,
plus visitors. Service-bound calls share billing with their parent; conservatively
reserve 13,000/day for machinery and retries. A visible page adds 2880/day; hidden
tabs pause polling. Keep below roughly 30 continuously visible pages/account at
these frequencies and monitor actual usage before approaching 100,000/day.

Steady-state estimates, including raw retention deletes and secondary indexes:
roughly 79–85k row writes/day, under 3m reads/day plus one row/public read. Steady-state evaluation measured 25 writes and 41 reads in remote D1; a
7,200-sample rolling summary measured 43,446 reads, so summaries run every
30 minutes (about 2.1m reads/day). The compact raw table avoids duplicate
primary-key B-tree writes. The original raw table remains for rollback and
is pruned on its original 14-day schedule. These
are estimates, **not** a quota guarantee; sustained incident churn increases
writes. Target warning thresholds: 85k writes, 4m reads, 80k requests, 400 MB D1.
`storage-budget.py` measured about 8.30 MiB for 14-day raw checks/evaluations plus
400-day rollups with indexes. Reserve 50 MiB for real history, notes and overhead.
`check-cloudflare-budget.py` checks shared daily D1/Worker usage and database size
in every independent GitHub ops-check run, failing before hard allowances. Analytics
can lag ingestion; it is an early warning rather than a quota reservation.
`profile-workers.py` records actual CPU/request evidence; Free CPU must remain below
10,000 microseconds per top-level invocation. Review again after one week of load.

Initial host baseline was ~390 MiB available. With collection, Alloy used ~63 MiB
and ~0.34% sampled CPU; host available memory was ~383 MiB. Recheck over normal load;
these are point observations, not peak guarantees. Later collection remained within
the cap but approached it during restart; monitor the container-memory panel. Keep the 128 MiB cap and avoid
adding container discovery, logs or traces until headroom is measured again.

Validation includes reducer and SQLite/D1 transaction tests, authentication and
replay tests, quota errors, export retries, API origin isolation and bot shutdown;
seven browser fixture states and mobile overflow; and a real isolated Workers/D1
preview exercising mixed severities, all-down and three-check recovery. The D1
restore rehearsal restored 105 fixture checks and 12 incidents to a separate
remote database. Production has never been populated with those fixtures.

## Backup and rollback

PostgreSQL backups do not cover D1. D1 Free provides seven days of Time Travel.
For longer retention, periodically export the dedicated database to encrypted
operator storage. Export can briefly block D1, so perform it off-peak and expect
monitoring gaps to be shown honestly. Redirect CLI output because export commands
can print temporary signed download URLs.

```sh
umask 077
pnpm exec wrangler d1 export quotedb-status --remote --config wrangler.monitor.generated.json --output /private/status.sql > /private/status-export.log
```

Rehearse restoration to a **new** database, never over the live history:
`wrangler d1 create quotedb-status-restore`, configure its separate ID, then
`wrangler d1 execute ... --remote --file /private/status.sql`. Compare check and
incident counts and query the public snapshot. Keep restoration targets unrouted;
remove the disposable restore database only after verification. To recover
production, restore a separate DB first and deliberately switch bindings/domain.

Use `wrangler versions list` and `wrangler rollback <version-id>` for each affected
Worker. Keep additive migrations; rollback must not drop data. Roll back application
images separately with the existing deployment workflow. On collector pressure,
stop Alloy (`docker compose stop alloy`); API/bot requests and D1 monitoring continue.
Before removing infrastructure, export D1 and disable its cron jobs explicitly.

The selected Grafana stack was on its existing Free Trial during setup. No paid
upgrade was made. Confirm its post-trial Free retention and active-series allowance
in the account portal during the one-week review.

## Release evidence (2026-11-02)

Production Cron CPU samples after splitting work: frontend 4–6 ms, backend 7–9 ms,
state evaluation 2–4 ms, snapshot/retention 4–8 ms, exporter 7 ms; public HTTP reads
0–4 ms and heartbeat verification 0–3 ms. Disposable paired timeout probes used
1–3 ms CPU despite five seconds of network waiting; failed/incident evaluation
used 4 ms. Early combined implementations exceeded 10 ms and were replaced.
These are measured samples, not a guarantee for arbitrary future load. Keep the
one-week review and account quota checks; no paid plan was enabled.

The actual remote D1 rolling-day query read 43,446 rows for approximately 7,200
samples. Compact steady evaluation wrote 25 rows/read 41. Local retained storage
simulation measured 8.30 MiB including indexes. Production history began with real
observations. The preview restore and outage tests used disposable data only.

Both repository CI (including Playwright) and independent status deployment passed.
The full application release restored ordinary GHCR image ownership and all five
containers were healthy/running. The independent ops-check passed endpoint,
freshness and shared Cloudflare quota checks. Four Grafana rules evaluated healthy;
Grafana accepted the authorized email contact-point test.

## Site and web app service notices

Both navigation bars link to the public status page. Their yellow notice uses
`GET /api/notice`, a cross-origin, read-only projection of the existing public
snapshot containing component status and observation timestamps. It reports only
confirmed `down` or `degraded` components with observations no older than three
minutes. Monitoring failures, unknown status and maintenance do not imply an outage.
The notice clears on recovery or when fresh monitoring cannot be obtained.

Visible pages refresh once per minute and when returning to the tab; hidden tabs
pause polling. Each continuously visible tab adds up to 1,440 requests/day (plus
visibility changes) to the shared Workers quota and one snapshot row read per
uncached request. This adds no cron triggers or database writes. Include public
traffic in the existing Free-budget checks.
