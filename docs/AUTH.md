# Authentication

QuoteDB uses email codes for existing/invited web users and Cloudflare Access for administrators.
There is no public registration. This supersedes the password-based authentication sections of
MIGRATION.md. Application roles, collection membership, and API tokens remain in QuoteDB.

## Web

`POST /api/v1/auth/code/request { email }` returns a random `challenge_id`, `expires_in: 600`,
and `retry_after: 60`, whether or not the account exists. Only active existing accounts receive
an email through the configured SMTP/Resend transport. `POST /api/v1/auth/code/verify
{ challenge_id, code }` consumes the challenge and creates the usual 30-day HttpOnly session.
There are no passwords or browser-stored access/refresh tokens.

Codes have six digits and expire in ten minutes. PostgreSQL stores an HMAC-SHA256 digest using
AUTH_CODE_SECRET and the challenge ID, never the code. Redemption and session creation share a
transaction. A challenge permits five attempts. A resend invalidates outstanding challenges.
Persistent budgets limit sends to one per minute and five per hour per email, 30 per hour per IP,
and AUTH_EMAIL_HOURLY_LIMIT (default 1000) per hour across the deployment. Verification is limited
to 20 attempts per hour per email and 60 per hour per IP, including across resends and restarts.
These are fixed windows; the five-attempt challenge limit still applies across a window boundary.
Expired challenge/budget records are pruned opportunistically after one day.

SMTP runs asynchronously so its latency or failures do not reveal account existence. Failed
sends invalidate the challenge and emit a delivery-failure audit event without the code. A
process interruption during delivery may require the user to request another code after the
cooldown. Existing sessions work during email outages. Monitor delivery failures and budget
rejections before increasing limits.

Invitations link to `/login`. Password/reset endpoints are retired; old reset-page URLs explain
email-code login. Email changes revoke web sessions and pending challenges, and notify the old
address. User deletion invalidates challenges; restoring the account does not restore them.
Lost-mailbox recovery is administrator-assisted after independently verifying the requester's
identity. Do not change an email merely because someone requests it from a new address.

## Administration

The production admin UI is served from a dedicated proxied hostname, recommended
`admin-quotes.elmu.dev`. Its API uses the same origin under `/api/v1/admin/*`. The old
`admin.quotes.elmu.dev` hostname redirects there. Other hosts remain DNS-only.

Cloudflare Access authenticates allowlisted administrator emails using its OTP provider. Every
admin API request also verifies the JWT signature, expected team issuer, application audience,
and expiry, then looks up an active local ADMIN/SUPER_ADMIN account. A web cookie, API token,
Access token for another application, or an allowlisted email with no local admin role cannot
administer QuoteDB. Existing role hierarchy and actor audit IDs are preserved. Caddy's
`forward_auth` applies this same check to static admin pages, so direct-origin access fails closed.
CSRF checks require the admin origin for administrative writes.

Application session duration is eight hours; the existing team's global session duration also
affects when Cloudflare asks for another code. Local deletion/demotion takes effect on the next
request even if the Access JWT is still valid. To remove an administrator, revoke their local
role/account and remove their email from the Access allowlist. API-side signature validation
alone does not discover Cloudflare token revocation; the edge enforces it on proxied traffic.

Logout uses `/cdn-cgi/access/logout`. Cloudflare documents that it revokes the user's Access
sessions across applications in the same team, with a
20–30 second revocation propagation period. It does not revoke QuoteDB web cookies.
See [Cloudflare session management](https://developers.cloudflare.com/cloudflare-one/access-controls/access-settings/session-management/)
and [JWT validation](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/).

## Local development

1. Start PostgreSQL and Mailpit with `pnpm db:up`; migrate and seed as usual.
2. Run `node scripts/admin-dev.mjs` once. This generates private/public keys under ignored
   `.local/` and adds local configuration to `.env`. Restart the development servers.
3. Open the web app and request a code for `izaro@quotedb.local`; read it in Mailpit.
4. Open the admin app. The development-only Vite proxy signs assertions for the configured
   ADMIN_DEV_EMAIL (default `admin@quotedb.local`). Change that value and restart to test roles.

The API still checks a real signature, issuer, audience, expiry, and database role. Production
rejects ADMIN_DEV_PUBLIC_KEY. Missing production Access settings or AUTH_CODE_SECRET prevent
startup. Do not expose the local development proxy publicly. Signing keys are excluded from Git
and Docker build contexts. Browser tests generate their own key pair and use Mailpit; override
E2E_SMTP_URL and E2E_MAILPIT_URL if local ports differ from 1025 and 8025.

## Production cutover

No live Cloudflare configuration is changed by local development or tests. Before deploying:

1. Confirm the existing Cloudflare Zero Trust team slug and administrator email allowlist.
   Every allowed email must match an active local admin account. Verify those inboxes are usable.
   Reuse the account's existing OTP identity provider via `access_otp_provider_id` when available.
2. Configure CI variables (or GitHub secrets): `ADMIN_HOST=admin-quotes.elmu.dev`, `CF_ACCESS_TEAM`, `ADMIN_EMAILS`
   (JSON array), and optional `CF_ACCESS_OTP_PROVIDER_ID`. CLOUDFLARE_ACCOUNT_ID remains the
   account used for R2 and Access. The API token needs Zone DNS Edit, Zone SSL and Certificates
   Edit, and account Access Apps/Policies and Identity Providers Write permissions.
3. Use a first-level admin hostname covered by the zone's Universal SSL certificate. Ensure
   Cloudflare SSL/TLS is **Full (strict)** for that hostname; do not use Flexible. This change
   does not overwrite account-wide SSL settings or the shared team's global session settings.
4. Review the OpenTofu plan. It adds the proxied admin records, explicit allowlist, Access app,
   independent code HMAC secret, and an Origin CA certificate/private key. It preserves the
   existing DNS-only hosts and database. Import any pre-existing records before applying.
5. Build with both DOMAIN and ADMIN_HOST. Export `admin_origin_certificate` and
   `admin_origin_private_key` into private files alongside the existing environment outputs.
   CI handles this automatically. Manual deploys must set ADMIN_HOST, ADMIN_ORIGIN_CERT_FILE,
   and ADMIN_ORIGIN_KEY_FILE before invoking `infra/droplet/deploy.sh`.
6. Deploy the additive migration and new images together. Caddy mounts the origin certificate
   and key read-only. The protected admin hostname uses Origin CA because Access can block
   ordinary ACME validation; the DNS-only hosts continue using Caddy's normal certificates.
7. Smoke-test actual code delivery, invitation, ordinary web login, admin OTP login, admin
   edits, logout, and bot/public API traffic. Anonymous admin requests must be challenged;
   a direct-origin admin request with no JWT must fail. Check email failures and Access denials.

Origin CA certificates are not browser-trusted: do not disable proxying for the protected admin
hostname. The certificate is valid for three years; daily ops checks warn 30 days before expiry.
Rotate using a reviewed OpenTofu replacement of `cloudflare_origin_ca_certificate.admin`, then
redeploy the new certificate. See [Origin CA documentation](https://developers.cloudflare.com/ssl/origin-configuration/origin-ca/).

Self-hosted production uses the same design. Configure ADMIN_HOST, CF_ACCESS_TEAM, CF_ACCESS_AUD,
AUTH_CODE_SECRET, and place `admin-origin.crt`/`admin-origin.key` beside the Compose file. The
private key must be mode 600. Use the local development workflow for an offline local setup.

## Password removal

Migration 0003 permanently drops `users.password_hash`, `users.password_algo`, and the
`password_reset_tokens` table. Password hashing dependencies and HIBP checks are removed.
Legacy MySQL imports discard passwords. Historical migration files remain so a fresh database
can replay the migration history; the final schema contains no user password storage.

Password-era application releases are no longer compatible with this schema. Rollbacks must
use a release compatible with the passwordless schema. Existing database backups can retain old
hashes until their retention period expires; dropping live columns does not erase backups.

## Health-only monitoring exception

`https://<ADMIN_HOST>/_monitor/health` is a separate Access application with an exact
service-token policy. At the origin, the API verifies its separate audience and
issuer, the exact service `common_name`, and an additional monitoring secret. It
returns only `{ok, asset}` readiness. It checks PostgreSQL and the deployed Admin
shell/asset through Docker-only Caddy port 8091; that port must never be published.
Anonymous callers, arbitrary service identities and human-audience tokens are
rejected. The service token cannot authorize `/api/v1/admin/*` or Admin HTML;
existing human Access JWT and local-role guards are unchanged. This is not an
end-to-end OTP sign-in test. Operational details are in
[`infra/observability/README.md`](../infra/observability/README.md).
