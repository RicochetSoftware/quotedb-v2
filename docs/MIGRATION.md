> Authentication update: [AUTH.md](AUTH.md) supersedes the email/password and shared-admin-session design below. Web users use email codes; administrators use Cloudflare Access plus local roles.

# QuoteDB v2 — Migration Plan

A from-scratch rewrite of QuoteDB from Laravel 11 / Inertia / Filament (DigitalOcean + Ploi) to a TypeScript monorepo (one DigitalOcean Droplet for the full stack, defined as code). This document covers stack analysis, target architecture, data migration, and a phased delivery plan.

---

## Prerequisites
- Get your thigh-high socks on 🧦
- [Put on some bangers](https://www.youtube.com/watch?v=-BhlIAwmyBk&t=111s)


## 1. Current State (What We're Replacing)

- **Backend:** Laravel 11, PHP 8.2, MySQL 8
- **Frontend:** Inertia.js + Vue 3 SPA
- **Admin:** Filament 3 at `/admin` (gated by `UserRole` enum: `USER`, `ADMIN`, `SUPER_ADMIN`)
- **API:** Sanctum tokens, Scramble docs, versioned at `/api/v1/`
- **Models:** `User` (soft-deletes, roles, HasApiTokens) and `Quote` (text, author, user_id, soft-deletes)
- **API surface (small):**
  - `GET /api/v1/quotes/search/user/{id}?max_quotes=N`
  - `GET /api/v1/quotes/random/user/{id}?max_quotes=N`
  - `POST /api/v1/quotes` (with optional backdated `date`)
  - `POST /api/tokens/create`, `GET /api/tokens`, `DELETE /api/tokens/{id}`
- **Web routes:** `/`, `/login`, `/quotes`, `/random`, `/izaro`, `/logout`
- **Hosting:** DigitalOcean droplet managed via Ploi; deploys on push to `master`

The footprint is small — this is a rewrite of opportunity, not a forced migration.

---

## 2. Stack Analysis & Recommendations

I went through the proposed choices one at a time. Verdict format: ✅ keep, ⚠️ keep with caveat, 🔄 swap suggested, ➕ missing piece worth adding.

### 2.1 API: Fastify + TypeScript ✅
Solid pick. Fastify is fast, schema-first, mature, and pairs perfectly with TypeBox (its native JSON-Schema integration drives both validation and response serialization with near-zero overhead). Alternatives considered:
- **Hono** — leaner, edge-friendly, but ecosystem (esp. plugins for auth/rate-limit/CORS/multipart) is thinner. Not worth swapping unless you want Cloudflare Workers later.
- **NestJS** — too heavy for an app this size; replaces "Laravel-ish opinions" with "Angular-ish opinions."
- **tRPC** — great for tightly-coupled monorepos, but you also need a public REST API surface (existing token-auth consumers / scripts), which TypeBox + OpenAPI gives you out of the box.

**Keep Fastify.**

### 2.2 Validation: TypeBox ✅ (locked in)
TypeBox at every layer — Fastify request/response schemas, shared validators in `packages/shared`, and client-side form validation. JSON Schema for free, fastest validator (Ajv), zero-cost serialization at the Fastify boundary.

For frontend forms, use `react-hook-form` with the `@hookform/resolvers/typebox` resolver so the same TypeBox schemas drive UI validation and API validation. Use `Value.Parse` / `Value.Errors` from `@sinclair/typebox/value` for any ad-hoc validation outside Fastify.

### 2.3 Database: PostgreSQL 17 ✅
Straight upgrade from MySQL. Better JSON, full-text search (`tsvector`), partial indexes, generated columns, `RETURNING` clauses. No reason to stay on MySQL for a greenfield TS project.

### 2.4 ORM / Query Builder: Drizzle ✅ (locked in)
TypeScript-first, SQL-shaped, lightweight, no codegen step. Use `drizzle-kit` for migrations.

### 2.5 Auth: Email + password → opaque session cookie ✅ (revised)
Drop JWT and drop magic codes. Email + password with stateful sessions in Postgres (opaque token in an httpOnly cookie). This is what the current Laravel app does and the existing bcrypt password hashes can be carried over verbatim (see §4) — users don't need to reset on cutover.

**Components:**
- **Hashing:** **argon2id** for new passwords (`argon2` Node lib). Verify Laravel's existing bcrypt hashes (`$2y$…`) with the `bcrypt` lib at login; on successful login of a legacy-hash user, transparently rehash to argon2id and update the row. Within ~1 month of cutover everyone is on argon2id.
- **Sessions:** opaque token (32 random bytes, base64url) → httpOnly, secure, sameSite=lax cookie. DB row in `sessions` with hashed token, expiry, user-agent, IP. Revocable instantly.
- **Login rate limit:** `@fastify/rate-limit` keyed on `email` (not just IP) — 5 attempts / 15 min, then return a generic "invalid credentials" with backoff. Lock the row temporarily, never reveal which field was wrong.
- **Password reset:** `POST /auth/password/forgot { email }` → email a single-use, 1-hour, hashed token to the address (always 200 — never confirm whether email exists). `POST /auth/password/reset { token, new_password }` consumes it.
- **Registration policy:** the existing app has no public signup (admin creates users in Filament). Keep that — admins create users, set initial password (or send invite-style password-set email). No public `/register` route.
- **Password policy:** min 12 chars; check against the `@have-i-been-pwned` k-anonymity API on set (refuse known-breached passwords). No arbitrary complexity rules.

**Why not Better-Auth / Lucia / NextAuth:** Lucia is deprecated. Better-Auth is good but adds opinions you don't need for one app + admin. Email/password + sessions is ~200 lines you fully control.

For external API consumers, a separate **personal access token** flow (§3.6): random opaque token, hashed in DB, `Authorization: Bearer …`. Independent from the password login.

### 2.6 Email: Nodemailer + Mailpit ✅
- **Nodemailer** is the standard.
- **Mailpit** for local dev is the right pick (faster and better UI than MailHog).
- For production, you didn't specify a transport. Recommend **Resend** (clean DX, generous free tier, Nodemailer-compatible via SMTP) over Mailgun (which the Laravel app currently uses — rip it out). Postmark is also fine if deliverability matters more than price.

### 2.7 Testing: Vitest ✅
Right call. Pair with:
- **Supertest** or Fastify's `app.inject()` for HTTP tests (prefer `inject` — no socket overhead).
- **Testcontainers** (`@testcontainers/postgresql`) for integration tests against real Postgres. Don't mock the DB. (This bites people; spend the 30s of startup time.)
- **Playwright** for one happy-path E2E per app once stable. Don't try to cover everything — your unit/integration tests will catch most regressions.

### 2.8 Web app: React + Vite + Tailwind + TanStack Router + TanStack Query + sonner ✅ (locked in)
**Final web stack:** React + Vite + Tailwind + TanStack Router + TanStack Query + shadcn/ui + react-hook-form (TypeBox resolver) + sonner + lucide-react + Urbanist via `@fontsource/urbanist`.

➕ Worth adding (not yet in your list, recommended):
- **shadcn/ui** — copy-pasted components on top of Radix + Tailwind. Saves a lot of UI primitive work (dialogs, dropdowns, tables, command menus). Same install in `apps/web` and `apps/admin`.
- **react-hook-form** + `@hookform/resolvers/typebox` — for forms (login, add-quote, token creation). Shares TypeBox schemas with the API.

### 2.9 Admin: React + Vite + Tailwind ✅ (locked in — separate app)
Separate `apps/admin` deployed at `admin.<domain>`. Cookie scoped to apex domain (`Domain=.<domain>`) so the same session works on `app.<domain>` and `admin.<domain>` after login. CSRF protection: same-origin checks via Origin/Referer header on state-changing requests.

Same UI kit as `apps/web` (shadcn/ui, Tailwind, TanStack Router/Query, lucide). Shared API client and TypeBox schemas via `packages/shared` so both apps stay in sync with the API.

Caveat to be honest about: you're rebuilding what Filament gave you for free. Budget 2–3 days for the admin CRUD (users list/edit/delete, quotes list/edit/delete, role changes, soft-delete restore). If that estimate balloons, **Refine.dev** is a drop-in escape hatch — React framework built for admin/CRUD that integrates with shadcn and would slot into `apps/admin` without changing anything else.

### 2.10 Site: Astro static landing ✅
Right tool. Static, fast, content-friendly. No notes.

### 2.11 Monorepo: pnpm workspaces ✅ ➕
pnpm workspaces is the right base. For a 4-package repo it's enough by itself. Once builds get slow or you're in CI a lot, add **Turborepo** (or **Nx**) for cached task orchestration. Don't add it day one.

➕ Add to repo root:
- **Biome** or **ESLint + Prettier** for lint/format. Biome is faster and one tool; ESLint+Prettier is the safer ecosystem choice. Pick one and don't mix.
- **TypeScript project references** so `tsc -b` builds packages in the right order and editors get cross-package type intelligence.
- **Husky + lint-staged** for pre-commit format/lint.
- **Changesets** if you ever publish `packages/shared` separately (probably not — it's an internal package).

### 2.12 Hosting: one DigitalOcean Droplet (revised 1 Nov 2026)

The full stack runs on a Frankfurt Droplet (`fra1`, `s-1vcpu-1gb`): PostgreSQL 17,
Fastify API, and Caddy serving web/admin/site plus API TLS. The 1 GB plan is $6/month
before tax and optional services, verified with `doctl compute size list` on 1 Nov 2026.
Cloudflare remains the DNS provider and R2 holds encrypted OpenTofu state. Pages is no
longer used. Images are built in GitHub Actions and pulled from GHCR.

This replaces the earlier UpCloud managed-database plan because of cost, and keeps all
application hosting on one server as requested. A 2 GB swap file and container memory
limits provide headroom; actual production memory use still needs monitoring. The old
managed database's backup/upgrade guarantees no longer apply: we own PostgreSQL backups
and restores. Daily local logical dumps need off-server copies to survive Droplet loss.
Optional paid DigitalOcean system backups are disabled by default.

All four hosts are DNS-only A/AAAA records terminating TLS at Caddy. Existing records for
`quotes.elmu.dev` must be adopted or replaced during cutover without leaving stale IPs.
The authoritative operational instructions are in [`infra/README.md`](../infra/README.md).

### 2.13 Summary table (after lock-in decisions)

| Layer | Choice |
|---|---|
| API runtime | Fastify |
| Schema/validation | TypeBox (everywhere) |
| DB | Postgres 17 |
| ORM | Drizzle + drizzle-kit |
| Auth | Email + password, argon2id (legacy bcrypt verified + lazy rehashed), opaque session cookie |
| API tokens | Random opaque, sha256-hashed, feature-scoped (§3.6) |
| Email (dev) | Mailpit |
| Email (prod) | Resend |
| Tests | Vitest + Testcontainers + Playwright (one happy-path E2E) |
| Web | React + Vite + Tailwind + TanStack Router + TanStack Query + shadcn/ui + react-hook-form + sonner + lucide-react + Urbanist |
| Admin | Same stack as `web`, separate app at `admin.<domain>`, shared session cookie |
| Site | Astro |
| Monorepo | pnpm workspaces (+ Biome, + TS project refs) |
| Hosting | One DigitalOcean Droplet (API + PostgreSQL + Caddy + all static apps), 1 GB in Frankfurt |
| Infrastructure as code | OpenTofu (DigitalOcean + Cloudflare providers), state in R2, swappable backend module (§3.7) |

---

## 3. Target Architecture

### 3.1 Repo layout
```
quotedb-v2/
├── apps/
│   ├── api/                  Fastify + Drizzle + TypeBox
│   ├── web/                  React + Vite + Tailwind + TanStack Router (user-facing)
│   ├── admin/                React + Vite + Tailwind + TanStack Router (admin panel, separate deploy)
│   └── site/                 Astro static landing
├── packages/
│   ├── shared/               TypeBox schemas, types, API client, constants
│   └── ui/                   shadcn-style components, theme, TypeBox form resolver (shared by web + admin)
├── e2e/                      Playwright happy paths (one per app)
├── infra/                    all infrastructure as code (§3.7)
│   ├── terraform/            OpenTofu root + module (digitalocean-backend)
│   ├── docker/               api.Dockerfile (platform-neutral)
│   ├── droplet/              whole-stack compose + deploy/backup/ops-check scripts
│   └── selfhost/             compose.yaml + Caddyfile: whole stack, incl. Postgres, on any VPS (exit plan)
├── docker-compose.yml        postgres + mailpit for local dev
├── .env.example
├── biome.json
├── pnpm-workspace.yaml
├── turbo.json (later)
└── package.json
```

### 3.2 `apps/api` layout
```
apps/api/
├── src/
│   ├── server.ts             Fastify factory (no listen here)
│   ├── index.ts              listen + signal handling
│   ├── env.ts                TypeBox-validated env (the whole env contract)
│   ├── migrate.ts            applies drizzle/ migrations (dist/migrate.js, run before each deploy)
│   ├── db/
│   │   ├── client.ts         drizzle client (postgres.js)
│   │   ├── schema.ts         tables: users, quotes, sessions, password_reset_tokens, api_tokens
│   │   └── seed.ts           dev-only seed
│   ├── auth/
│   │   ├── session.ts        opaque session tokens + cookie options
│   │   ├── api-token.ts      token format, O(1) lookup, scope check
│   │   └── plugin.ts         resolves request.auth (cookie or bearer), CSRF origin check, guards
│   ├── modules/
│   │   ├── auth/             login, logout, sessions, password forgot/reset/change, GET /me
│   │   ├── quotes/           CRUD + search + random + v1 back-compat shim
│   │   ├── tokens/           personal access tokens
│   │   ├── public/           GET /public/izaro
│   │   └── admin/            users, quotes, stats
│   └── lib/                  crypto, passwords (argon2/bcrypt/HIBP), mailer, emails, serializers
├── drizzle/                  SQL migrations generated by drizzle-kit
└── test/                     vitest specs (app.inject + Testcontainers Postgres)
```

### 3.3 Database schema (Drizzle, target)
```ts
// packages/shared exposes types only; schema.ts lives in apps/api/src/db
users(
  id uuid pk default gen_random_uuid(),
  email citext unique not null,            // citext = case-insensitive
  name text not null,
  password_hash text null,                 // argon2id ($argon2id$…) or legacy bcrypt ($2y$…); null = invite pending
  password_algo text not null default 'argon2id',  // 'argon2id' | 'bcrypt-legacy'
  role text not null default 'USER',       // 'USER' | 'ADMIN' | 'SUPER_ADMIN'
  external_id integer null,                // legacy MySQL id, see §4
  created_at timestamptz, updated_at timestamptz,
  deleted_at timestamptz null              // soft delete
)
quotes(
  id uuid pk,
  user_id uuid fk users.id,
  quote text not null,
  author text not null,                    // index
  external_id integer null,                // legacy MySQL id
  created_at timestamptz, updated_at timestamptz,
  deleted_at timestamptz null
)
sessions(
  id uuid pk,
  user_id uuid fk users.id not null,
  token_hash text not null unique,         // sha256(opaque session token in cookie)
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz,
  user_agent text, ip text
)
password_reset_tokens(
  id uuid pk,
  user_id uuid fk users.id not null,
  token_hash text not null unique,         // sha256(token sent via email)
  purpose text not null default 'reset',   // 'reset' (1 hour) | 'invite' (7 days, admin-created users)
  expires_at timestamptz not null,
  consumed_at timestamptz null,
  created_at timestamptz not null default now()
)
api_tokens(
  id uuid pk,
  user_id uuid fk users.id not null,           // tokens are ALWAYS scoped to one user
  name text not null,                          // user-supplied label, e.g. "ci-pipeline"
  prefix text not null,                        // e.g. "qdb_live_a1b2c3d4" — shown in UI/logs, safe to display
  token_hash text not null unique,             // sha256(secret); the secret itself is shown ONCE on creation
  scopes text[] not null default '{}',         // see §3.6 — e.g. {'quotes:read','quotes:write'}
  expires_at timestamptz null,                 // optional — null = never expires
  last_used_at timestamptz null,
  last_used_ip text null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz null
)
// indexes: (user_id) for listing; (token_hash) unique; (revoked_at) where null for hot lookup
```
- **UUIDs over auto-incrementing IDs** — safer for public APIs; if external consumers rely on integer IDs from the old API, keep an `external_id` integer column and migrate values from the old table (see §4).
- **Soft deletes via `deleted_at`** — query helper / Drizzle filter `isNull(deleted_at)`. No global scope magic.

### 3.4 API surface (v1, REST)
Document via `@fastify/swagger` from the TypeBox schemas in `packages/shared`. Two important rules:
1. **Identity is taken from the auth context (session cookie OR API token), never from the request body or path.** A token always acts as its owning user.
2. **Each route declares the feature scope it requires.** Session-cookie callers bypass scope checks (the UI uses every feature); API-token callers must hold the listed scope. See §3.6.

```
# auth (session-cookie flow)
POST   /api/v1/auth/login              { email, password } → sets session cookie
POST   /api/v1/auth/logout             revokes session row
POST   /api/v1/auth/password/forgot    { email } → emails reset link (always 200)
POST   /api/v1/auth/password/reset     { token, new_password } → sets new hash, kills all sessions
POST   /api/v1/auth/password/change    { current_password, new_password, revoke_other_sessions? }   (session only)
GET    /api/v1/auth/sessions           list my sessions (session only)
POST   /api/v1/auth/logout-others      revoke my other sessions (session only)
GET    /api/v1/me                      [scope: profile:read]

# quotes — always operates on the authenticated user
GET    /api/v1/quotes?max=N&author=…&q=…    [scope: quotes:read]
GET    /api/v1/quotes/random?max=N           [scope: quotes:read]
GET    /api/v1/quotes/:id                    [scope: quotes:read]
POST   /api/v1/quotes  { quote, author, date? }   [scope: quotes:write]
PATCH  /api/v1/quotes/:id                    [scope: quotes:write]
DELETE /api/v1/quotes/:id                    [scope: quotes:write]

# personal access tokens — session cookie ONLY (you cannot mint tokens with a token)
POST   /api/v1/tokens   { name, scopes[], expires_at? } → { token } (shown once)
GET    /api/v1/tokens                list MY tokens (no secrets)
DELETE /api/v1/tokens/:id            revoke

# admin — session cookie ONLY, role-gated
GET    /api/v1/admin/users
PATCH  /api/v1/admin/users/:id
DELETE /api/v1/admin/users/:id
GET    /api/v1/admin/users/:id/quotes        admin cross-user read
# (implemented in full: see §9 for the complete admin surface)

# public
GET    /api/v1/public/izaro                  random quote of IZARO_USER_ID (v1 /izaro parity)
```

Two auth mechanisms:
- **Cookie session** — for web/admin UI. Full privileges of the user's role. All scopes implicitly granted. Can mint API tokens. Only mechanism for `/admin/*` and `/tokens` write endpoints.
- **`Authorization: Bearer <api_token>`** — for scripts/external consumers. Granted only the feature scopes selected at creation time (§3.6). **Cannot** mint or revoke tokens, **cannot** access admin routes, **cannot** act as another user.

Key rule: `POST /quotes` no longer accepts `user_id` in the body. The user is always the caller. Admin imports of quotes for other users go through `/api/v1/admin/...` with a session cookie.

**Back-compat shim for old API consumers** (see §4.2):
```
GET /api/v1/quotes/search/user/:id    [scope: quotes:read]
GET /api/v1/quotes/random/user/:id    [scope: quotes:read]
```
Returns 403 unless `:id` resolves (UUID or legacy integer via `external_id`) to the caller's own user. Removed in v2 release.

### 3.5 Frontend routes

**`apps/web`** — user-facing, served at `app.<domain>` (or apex)
```
/                          public — home
/login                     email + password
/forgot-password           request reset email
/reset-password?token=…    set new password
/quotes                    auth — list & add
/random                    auth — random viewer
/izaro                     public — keep parity with current app
/settings/account          auth — change password, sign out other sessions
/settings/tokens           auth — manage API tokens (scope checkboxes, list, revoke)
```

**`apps/admin`** — separate Vite build, served at `admin.<domain>`, role-gated
```
/login                     email + password (same backend; cookie scoped to apex)
/                          dashboard (counts, recent activity)
/users                     list, search, filter by role / soft-deleted
/users/:id                 edit name / role; reset password (sends email); soft-delete / restore
/users/new                 admin creates user → emails an invite-style password-set link
/quotes                    cross-user quote browser, filter by user / author / date
/quotes/:id                edit / soft-delete / restore
```
Both apps use the same session cookie. Admin enforces role on every page (redirect to `/login` if missing, `/forbidden` if logged in but not ADMIN/SUPER_ADMIN).

### 3.6 Feature-scoped API tokens — design

A user creates one or more API tokens from `/settings/tokens`. Each token belongs to its creator and carries a set of **feature scopes** that determine which API capabilities it can exercise. A read-only widget gets a `quotes:read` token; an importer script gets `quotes:read,quotes:write`. The token can never act as a different user, and it can never use a feature it wasn't granted.

#### Scope catalog (v2 launch — keep small, grow only when needed)

| Scope | Grants |
|---|---|
| `quotes:read` | List, get, search, random — own quotes only |
| `quotes:write` | Create, update, soft-delete — own quotes only |
| `profile:read` | `GET /me` |

Explicit non-scopes (cannot be granted to a token under any circumstance):
- Minting / listing / revoking tokens — session cookie only
- Any `/admin/*` endpoint — session cookie + role
- Acting as a different user

If a future need arises (e.g. webhooks, exports, OAuth-style apps), add new scopes — don't overload existing ones.

#### Token format

```
qdb_<env>_<token_id>_<secret>
        │       │         └── 32 random bytes (base62), never stored
        │       └────────── api_tokens.id (UUID, base62-encoded for compactness)
        └────────────────── 'live' or 'test' (matches APP_ENV; prevents staging-vs-prod mixups)

example:  qdb_live_7Hk2pQ_R8nM4xV9bL2cT6yF3dW1eS5jH8gA0kZ
                  └─ id ─┘└──────── secret ────────┘
```

- The full string is shown to the user **exactly once** at creation (clipboard + "I've saved it" confirmation).
- The DB stores: `prefix = "qdb_live_7Hk2pQ"` (id portion shown in UI/logs) and `token_hash = sha256(secret)`.
- Lookup is O(1): parse incoming token → fetch row by id → constant-time compare hashes. Never scan all rows.
- Prefix lets users (and us) identify a leaked token in logs without exposing the secret.

#### Authentication flow (per request)

1. Read `Authorization: Bearer <token>` header.
2. Validate format; reject malformed early (400, no DB hit).
3. Look up `api_tokens` by parsed id. If not found / `revoked_at IS NOT NULL` / `expires_at < now()` → 401.
4. Constant-time compare `sha256(secret) === token_hash`. Else 401.
5. Load owning user; if `users.deleted_at IS NOT NULL` → 401.
6. Attach `{ user, token, scopes }` to the Fastify request.
7. Async (don't block request): `UPDATE api_tokens SET last_used_at = now(), last_used_ip = $ip WHERE id = $id` — debounced to ~1/min per token to avoid write amplification.

#### Authorization (per route)

Fastify decorator pattern:
```ts
app.get('/quotes', { preHandler: [requireScope('quotes:read')] }, handler)
```
- Session-cookie callers: `requireScope` always passes (cookies grant everything the user's role permits).
- Token callers: `requireScope(s)` returns 403 unless `s ∈ token.scopes`.
- `requireScope` for `/admin/*` and `/tokens` write endpoints rejects token callers outright (403, not 401 — auth is valid, this auth type just can't do this).

#### Token creation API

```
POST /api/v1/tokens
Auth: session cookie required
Body: {
  name: string (1–100 chars, free-form label)
  scopes: ('quotes:read' | 'quotes:write' | 'profile:read')[]
  expires_at: ISO timestamp | null     // null = never; UI suggests 90d / 1y / never
}
Response 201: {
  id: uuid
  name, prefix, scopes, expires_at, created_at
  token: 'qdb_live_…_…'   // FULL token, only time it is ever returned
}
```
Validation: scopes must be a non-empty subset of the catalog; reject unknown scopes; reject duplicates.

#### Token UI (`/settings/tokens`)

- **List view:** name, prefix (e.g. `qdb_live_7Hk2pQ…`), scopes as pills, last used (relative), expires_at, "Revoke" button.
- **Create dialog:** name input, scope checkboxes (defaults to `quotes:read` only — least privilege), expiration dropdown (90d / 1y / never), submit.
- **After create:** modal with the full token, copy-to-clipboard, big yellow "this is the only time you'll see it" banner, "I've saved it" button to dismiss.
- **Revoke:** confirm dialog → sets `revoked_at`. Token is dead immediately; no grace period.

#### Rate limiting

- `@fastify/rate-limit` keyed on `token.id` for token-authed requests, on `user.id` for session requests, on IP for unauthenticated requests.
- Default: 100 req/min per token (matches the current Laravel API limit). Configurable per-token in a future iteration; not at launch.

#### Observability

Log on every token-authed request: `token.prefix`, `token.id`, `user.id`, route, status. **Never** log the full token. The prefix is sufficient for incident response ("I see token `qdb_live_7Hk2pQ` is making 1000 req/sec — I can find it in `/settings/tokens` and revoke it").

#### Test coverage (must-have before launch)

- Token with `quotes:read` only → 403 on `POST /quotes`, 200 on `GET /quotes`.
- Token cannot call `/tokens` or `/admin/*` regardless of scopes (403).
- Revoked token → 401 within one request.
- Expired token → 401.
- Token belonging to soft-deleted user → 401.
- `POST /quotes` body containing `user_id` → 400 (TypeBox `additionalProperties: false`); created quote belongs to caller.
- Two users' tokens cannot read each other's quotes (404, not 403, to avoid existence leak).
- Rate-limit triggers per-token, not per-user (one user with 5 tokens has 5×100 req/min total — acceptable).

### 3.7 Infrastructure as code

OpenTofu creates the DigitalOcean Droplet and cloud firewall, generates the PostgreSQL
password, cookie secret and pinned SSH host key, and points all four Cloudflare hostnames
at the Droplet. Native OpenTofu encryption protects the R2 state and plans. This configuration
requires OpenTofu; plain Terraform does not support its encryption block.

- `infra/terraform/modules/digitalocean-backend`: Droplet, firewall, secrets, cloud-init.
- `infra/terraform/main.tf`: application environment, backend module, DNS records.
- `infra/droplet`: API + PostgreSQL + static Caddy Compose stack, release scripts, daily
  logical backup script, operations checks.
- `infra/docker`: portable API and static/Caddy Dockerfiles, built in CI and published to GHCR.
- `infra/selfhost`: build-from-source Compose variant for another VPS or local use.

The module exposes IPv4/IPv6, a Docker-network database URL, separate API and PostgreSQL
environment files, and SSH target/known-hosts outputs. No public PostgreSQL port is opened.
Database access and imports go through SSH or containers on the server.

Cloud-init installs Docker, key-only SSH, UFW, unattended updates, a 2 GB swap file and a daily
backup timer. The Droplet has `prevent_destroy`; replacing it would destroy the local database.
Cloud-init edits are ignored after creation, so roll out changes explicitly over SSH. OS rebuilds
and Postgres major upgrades require a verified backup/restore procedure.

The deployment workflow builds both images off-server, applies infrastructure, and deploys the
whole stack over pinned SSH. It starts PostgreSQL, takes a dump, migrates, starts the new API and
Caddy, then checks HTTPS on all four hostnames. CI releases and remote deployment mutations are
serialized. Weekly releases refresh base images. Operations checks monitor service availability,
updates, disk, database health and backup age.

Local dumps are retained seven days and do not survive loss of the host. Copy them to separate
storage; optionally enable paid DigitalOcean system backups. Application rollback requires both
image references and does not undo database migrations.

For credentials, existing-DNS import, initial deployment, backups, restore commands and maintenance,
use [`infra/README.md`](../infra/README.md). There is no automatic migration from existing UpCloud
state or database data. Existing v1 MySQL data still requires the application migration below.

---

## 4. Data Migration

The existing DB is MySQL. Target is Postgres. Volume is small, so a one-shot dump-and-load is fine.

### 4.1 Strategy
1. Use a UTC MySQL dump with the original Laravel schema.
2. Run `python3 infra/migration/mysql_dump.py <dump.sql.gz> <private-output.sql>`.
   The standard-library converter reads only `users` and `quotes`; it never executes
   source SQL. The output contains private data and must stay outside the checkout.
   - Generate UUIDs in PostgreSQL, retaining integer IDs in `external_id`.
   - Map `user`, `admin`, `superadmin` to `USER`, `ADMIN`, `SUPER_ADMIN`; reject unknown roles.
   - Preserve UTC timestamps and soft deletions. Missing `updated_at` falls back to `created_at`.
   - Preserve bcrypt hashes verbatim with `password_algo = 'bcrypt-legacy'`.
     Existing passwords remain usable; successful logins upgrade hashes to argon2id.
   - Normalize emails to lowercase and preserve quote ownership through legacy IDs.
   - Exclude old sessions, password-reset tokens, Sanctum tokens and unrelated tables.
3. Take a production backup and copy it off the Droplet. Test against an isolated
   PostgreSQL database with the production schema before applying to production.
4. Apply with `psql -X -v ON_ERROR_STOP=1` through SSH, holding `.deploy.lock`.
   The SQL requires empty target tables, locks them, and compares every imported
   field in both directions before committing the transaction. Repeated imports fail.
5. Verify counts, ownership, API health, and take a post-import backup. Remove the
   temporary database and generated SQL. Unit tests: `python3 -m unittest discover -s infra/migration -v`.

Production import completed on **1 November 2026** from
`quotedb-prod-20261021-172749.sql.gz` (snapshot: 21 October 2026): **11 users and
173 quotes**, no soft-deleted records and no orphan quotes. Three quotes (legacy
IDs 9, 11, 89) had null update timestamps and used their creation timestamps.
Source SHA-256: `721dba0988e9cdb62fde881f7b12c8a36cc4d73f5dfbcfbab880bf7f026a244e`.
Both staging and production passed full-field comparisons; repeat-import rejection
was tested in staging. Existing-user login still requires a manual check with a
known password; no passwords were reset or emails sent by the import.

### 4.2 ID compatibility
External consumers currently call `/api/v1/quotes/search/user/{id}` with integer IDs. Two options:
- **Accept either**: route accepts UUID or integer; if integer, look up by `external_id`. Simple back-compat.
- **Hard cutover**: notify the (small set of) consumers and update them to UUIDs.

**Recommendation:** dual lookup for 1 release, then drop integer support.

### 4.3 Cutover
- Stand up v2 on a subdomain (`v2.<domain>`) and verify in prod with real data.
- DNS swap once verified. Keep the old droplet up for 2 weeks read-only as fallback.

---

## 5. Phased Delivery Plan

Estimate: ~3–4 focused weekends of work for one person. Each phase is independently shippable to staging.

### Phase 0 — Decisions & scaffolding (½ day)
- Confirm stack swaps from §2 (Drizzle, session-cookie auth, TanStack Router, separate web + admin apps, Resend).
- Initialize repo: `pnpm init`, workspace, biome, base tsconfig with project references.
- `docker-compose.yml`: postgres17, mailpit.
- Empty `apps/api`, `apps/web`, `apps/admin`, `apps/site`, `packages/shared`.
- CI skeleton (`.github/workflows/ci.yml`) — typecheck, lint, test.

### Phase 1 — API foundation (1–2 days)
- Fastify app factory, TypeBox type provider, TypeBox env validation, error handler, logger (pino).
- Drizzle schema for `users`, `quotes`, `sessions`, `password_reset_tokens`, `api_tokens`.
- Drizzle migrations + seed script.
- Plugins: `@fastify/cors`, `@fastify/cookie`, `@fastify/rate-limit`, `@fastify/helmet`, `@fastify/swagger` + UI.
- Health check, OpenAPI at `/api/documentation`.
- Vitest setup with Testcontainers Postgres.

### Phase 2 — Auth (1–1.5 days)
- `POST /auth/login` — argon2 verify; on bcrypt-legacy rows, fallback to bcrypt verify and rehash on success. Issue session: insert row with `sha256(token)`, set httpOnly secure sameSite=lax cookie scoped to `Domain=.<domain>`.
- `POST /auth/logout` — invalidate session row immediately.
- `POST /auth/password/forgot` — generate token, hash + store with 1h TTL, email reset link via Nodemailer (Mailpit in dev). Always return 200 — never confirm email existence.
- `POST /auth/password/reset` — consume token, set new argon2id hash, **revoke all of the user's sessions** (forces re-login everywhere), audit-log.
- `POST /auth/password/change` — auth required; verify current password, set new hash, optionally revoke other sessions.
- `GET /me`.
- Login rate limit: `@fastify/rate-limit` keyed on lowercased email, 5 attempts / 15 min, sliding window. Generic 401 message regardless of which field was wrong.
- Password strength check: min 12 chars + HIBP k-anonymity check on set/reset/change.
- Bearer-token middleware for `api_tokens` (cookie wins if both present).
- Tests: bcrypt-legacy verify, transparent rehash, reset token single-use, reset revokes sessions, login rate limit triggers, generic-error on wrong email vs wrong password, cookie domain set correctly.

### Phase 3 — Quotes API + feature-scoped tokens (1–1.5 days)
- All quotes endpoints in §3.4. `max_quotes` validation (1–1000); random ordering via `ORDER BY random()` (fine for current volume; revisit with TABLESAMPLE only if >100k rows).
- **Token system per §3.6:**
  - `requireScope(scope)` Fastify preHandler decorator — passes for cookie sessions, enforces for tokens, 403 for token callers on cookie-only routes.
  - Token creation/listing/revocation endpoints (cookie-only).
  - Token format `qdb_<env>_<id>_<secret>`, sha256 hashing, O(1) id-based lookup.
  - Async debounced `last_used_at` / `last_used_ip` updates.
  - Per-token rate limiting via `@fastify/rate-limit` keyGenerator.
- Back-compat shim routes `/quotes/search/user/:id` and `/quotes/random/user/:id` enforcing self-only access.
- Tests: full §3.6 must-have coverage list, plus quotes happy-paths. No DB mocks.

### Phase 4 — Web app `apps/web` (2 days)
- Vite + React + Tailwind + shadcn/ui init.
- TanStack Router with routes from §3.5 (web side).
- TanStack Query + typed API client from `packages/shared`.
- Pages: home, login, forgot/reset password, quotes list/add, random, izaro, settings/account, settings/tokens.
- react-hook-form + TypeBox resolver for all forms.
- Sonner toasts, lucide icons, Urbanist via `@fontsource/urbanist`.

### Phase 5 — Admin app `apps/admin` (2–3 days)
- Same Vite + React + Tailwind + shadcn/ui setup.
- TanStack Router with routes from §3.5 (admin side); role check on every authed route.
- Pages: login, dashboard, users list/edit/new (with admin-creates-user invite flow), quotes browser/edit.
- Reuse API client and TypeBox schemas from `packages/shared`.
- If this phase blows past 3 days, drop in **Refine.dev** for the CRUD scaffolding and keep moving — the rest of the stack doesn't change.

### Phase 6 — Site (½ day)
- Astro init, Tailwind, port the marketing landing content.
- Deploy preview.

### Phase 7 — Hosting & deploy, all as code (1–1.5 days)
*Revised 1 Nov 2026: all application services on a 1 GB DigitalOcean Droplet (§2.12).*
- One-time setup: DigitalOcean token, SSH deploy key, R2 state bucket/token, Cloudflare DNS token.
- OpenTofu root + `digitalocean-backend` module; inspect the plan before the first apply.
- Build API and static/Caddy images in CI, publish to GHCR, deploy `infra/droplet/compose.yaml`.
- PostgreSQL in a named Docker volume, daily and pre-migration dumps, off-server backup copies.
- Import old DNS records before pointing all four hostnames at the new Droplet.
- Configure Resend domain verification and the shared-cookie/CORS hostnames.
- Verify all four HTTPS hosts, the deployment workflow, and daily operations checks.
- Prove a database restore before relying on this server for production data.

### Phase 8 — Data migration & cutover (½ day + soak)
- Run migration script against staging from prod MySQL dump.
- Manual smoke: log in as existing user with their **existing password** (verifies bcrypt-legacy path), confirm quotes list matches old API output, confirm legacy-int IDs work via `external_id` lookup, verify admin sees all users.
- DNS cutover. Keep old DO droplet read-only for 2 weeks.
- After 2 weeks: tear down DO droplet & Ploi. Drop the bcrypt-legacy code path once `password_algo = 'bcrypt-legacy'` count hits 0 (or after a fixed deadline — force-reset stragglers).

---

## 6. Risks & Open Questions

- **Sanctum tokens won't carry over.** Any external scripts using current API tokens will break at cutover (different format, different hash, and the new tokens require explicit scope selection). Action: enumerate token holders before phase 7; have them re-issue tokens via `/settings/tokens` after first login. Default new tokens to `quotes:read` only (least privilege) and let the user opt into `quotes:write` if their script needs it.
- **Scope catalog discipline.** It's tempting to add scopes preemptively (`quotes:delete` separate from `quotes:write`, `quotes:read:public` etc.). Resist until there's a real use case — every scope is a UX choice the user has to make at token-creation time, and a permission matrix you have to test. Three scopes at launch is correct.
- **Password-reset email deliverability.** First time using Resend — verify domain SPF/DKIM in Phase 2, not at cutover. A broken reset email is a "users locked out" outage.
- **Legacy bcrypt path is a real code path.** Until `password_algo = 'bcrypt-legacy'` count hits 0, the login handler runs two verify branches. Tests must cover both. Set a deadline (e.g. 90 days post-cutover) after which any remaining bcrypt-legacy users get a forced password reset email — don't keep that branch alive forever.
- **Cross-subdomain cookies.** `Domain=.<apex>` is required for `app.` and `admin.` to share the session, but it also means any future subdomain inherits the cookie. Don't host untrusted content on subdomains. Use `__Host-` style cookies only if you drop the subdomain admin and put admin under a path instead.
- **`/izaro` route** — resolved: in v1 it is a public page showing a random quote from user #2. v2 keeps it public via `GET /api/v1/public/izaro`, with the featured user configured by `IZARO_USER_ID` (UUID or legacy integer id).
- **Session vs. JWT regret.** If you later want stateless auth across multiple services, you'll need to revisit. For one API + one web app, sessions are unambiguously simpler — don't preempt this.
- **Single server, local database.** Host downtime affects every site and the API. Disk loss requires an off-server backup and restore; rebuilding the Droplet alone loses data. `prevent_destroy` blocks accidental OpenTofu replacement. Each deployment and automatic reboot can cause brief downtime.
- **Upkeep that silently stops.** This is the v1 failure mode. Mitigations:
  - unattended-upgrades with automatic reboots
  - the weekly image rebuild
  - `ops-check.yml`, which fails loudly
  - someone has to read those emails: route them somewhere that's watched
- **SSH deploy key.** The `DEPLOY_SSH_KEY` secret can run anything on the server, and GitHub runners don't have fixed IPs, so port 22 is open to the internet. It's key-only, `ufw limit`, with no root login. Rotate the key if GitHub secrets are ever exposed.
- **Database durability:** seven-day local logical dumps do not survive disk loss. Copy backups off-server, monitor their freshness, and test restore procedures.
- **Secrets in Tofu state.** The DB password, cookie secret and SSH host key are in state. Use OpenTofu state encryption, and keep the R2 bucket private with a scoped token.

---

## 7. Locked-in stack (final)

- **API:** Fastify + TypeBox + Drizzle + Postgres 17.
- **Auth:** Email + password (argon2id, bcrypt-legacy compat) → opaque session cookie scoped to apex domain. No JWT, no magic codes.
- **API tokens:** feature-scoped (§3.6), `quotes:read` / `quotes:write` / `profile:read`.
- **Email:** Nodemailer + Mailpit (dev) / Resend (prod).
- **Web (`apps/web`):** React + Vite + Tailwind + TanStack Router + TanStack Query + shadcn/ui + react-hook-form (TypeBox resolver) + sonner + lucide-react + Urbanist.
- **Admin (`apps/admin`):** same stack as web, separate Vite build, deployed at `admin.<domain>`, shares session via apex-scoped cookie.
- **Site (`apps/site`):** Astro.
- **Monorepo:** pnpm workspaces + Biome + TypeScript project references. Add Turborepo only when build times demand it.
- **Hosting:** one 1 GB DigitalOcean Droplet in Frankfurt for API, PostgreSQL, and Caddy serving all frontend sites. Images built off-server; local database with explicit backup/restore procedures.
- **Infrastructure as code:** OpenTofu with DigitalOcean + Cloudflare providers, state in R2, platform isolated in one backend module. Portable Dockerfile + `infra/selfhost` compose stack = exit plan.

## 8. Add to the proposed stack

- Drizzle ORM + drizzle-kit (you didn't list one).
- shadcn/ui + react-hook-form (with `@hookform/resolvers/typebox`).
- argon2 (new hashes) + bcrypt (legacy verify) Node libs.
- Testcontainers (`@testcontainers/postgresql`) for integration tests against real Postgres.
- Biome for lint+format (one tool — don't add ESLint+Prettier on top).
- TypeScript project references for cross-package type inference.
- Resend for prod email.
- OpenTofu + Cloudflare R2 state for infrastructure as code (§3.7).
- Caddy serving all static apps from one image on the Droplet.

---

## 9. Implementation notes (Oct 2026)

Phases 0–7 are implemented. Production hosting and DNS cutover are complete. The legacy users and quotes were imported and verified on 1 November 2026 (see §4.1). A manual existing-user login check and the post-cutover soak remain.

### Versions actually used
Node 24, pnpm 12, TypeScript 7 (native), Fastify 5, TypeBox 1.x (the `typebox` package, not `@sinclair/typebox`), Drizzle 0.45, Vite 8, React 19, TanStack Router 1 / Query 5, Tailwind 4, Vitest 5, Astro 7, Playwright 1.64, Biome 2.6, OpenTofu 1.13 (DigitalOcean provider 2.106, Cloudflare 5.28).

### Deviations from the plan above, and why
- **Form validation:** `@hookform/resolvers/typebox` targets the old `@sinclair/typebox` package, so `packages/ui` has a ~40-line `typeboxResolver` for TypeBox 1.x. The same schemas still drive both form and API validation.
- **Shared UI:** shadcn-style components live once in `packages/ui` rather than being copied into both apps.
- **Legacy bcrypt:** verified with `bcryptjs` (pure JS, so no native build in the slim image). `$2y$` is mapped to `$2b$`, which is the same algorithm.
- **Invites:** `users.password_hash` is nullable (invite pending), and `password_reset_tokens.purpose` distinguishes `reset` (1 h) from `invite` (7 days). Admin-created users without a password get an invite email that uses the reset flow.
- **CSRF:** every state-changing request carrying the cookie (and every unauthenticated one, e.g. login) must send an `Origin`/`Referer` in `{WEB_URL, ADMIN_URL, APP_URL}`. Bearer-only requests are exempt. Non-browser clients therefore use tokens, not `/auth/login`.
- **Rate limits:** login is limited to 5 / 15 min per lowercased email and returns 429 with a generic message. Forgot-password is 3 / hour per email. The global limit is 100/min keyed by token, then user, then IP (the hook runs at `preHandler` so the caller is already resolved).
- **`/random`:** v1 picked from *all* users' quotes; v2 picks from the caller's own (consistent with "quotes always operate on the authenticated user").
- **Back-compat shim response:** keeps the v1 shape `{ quotes: [{ id, quote, author, date }] }`, but `id` is now the UUID.
- **Extra session endpoints:** `GET /auth/sessions` and `POST /auth/logout-others` back the "sign out other sessions" control on `/settings/account`.
- **Full admin surface:**
  - Users: `GET/POST /admin/users`, `GET/PATCH/DELETE /admin/users/:id`, `POST /admin/users/:id/restore` and `/password-reset`, `GET /admin/users/:id/quotes`.
  - Quotes: `GET/POST /admin/quotes`, `GET/PATCH/DELETE /admin/quotes/:id`, `POST /admin/quotes/:id/restore`.
  - Stats: `GET /admin/stats`.
  - Rules: SUPER_ADMIN manages everyone. ADMIN manages USERs only and can't grant SUPER_ADMIN. Nobody can change their own role or delete themselves. Soft-deleting a user revokes their sessions.
- **API build:** the API is bundled with esbuild (`apps/api/build.mjs`) so the TypeScript-source workspace packages are inlined. `pnpm deploy --prod` (no `--legacy` needed on pnpm 12) ships `dist/` plus `drizzle/`.
- **Dev ports:** web runs on :5180 and admin on :5181, not 5173/5174, so v2 can run alongside the v1 Sail stack.
- **`astro check`:** doesn't support TypeScript 7 yet, so `apps/site` alone pins TypeScript 6.
- **E2E:** Playwright starts web servers *before* `globalSetup`, so the throwaway `quotedb_e2e` database is prepared in the API server's start command (`e2e/prepare-db.ts`).

### Infrastructure deviations (§3.7, revised 1 Nov 2026)

- Hosting changed from the planned UpCloud server/managed database and Cloudflare Pages to a
  single DigitalOcean Droplet at the user's request. The old modules and deploy scripts were removed.
- `HOST=0.0.0.0` inside Docker; the host itself serves IPv4 and IPv6.
- Cloud firewall plus UFW; only Caddy publishes container ports. PostgreSQL stays private.
- OpenTofu generates a pinned SSH host key and quoted environment files. The PostgreSQL password
  is now generated by `random_password`, not returned by a managed database service.
- State/plan encryption is OpenTofu-only. R2 uses native S3 lockfiles.
- CI builds API and all frontends before deploying a single release. There are no Pages uploads.
- Small-server limits, swap, local daily/pre-migration dumps, and backup-age checks were added.
  Off-server backup copies and restore testing remain necessary for production durability.
- `prevent_destroy` protects the data-bearing Droplet from accidental replacement. Updating
  cloud-init or SSH public keys in code does not update an existing server; use SSH deliberately.
