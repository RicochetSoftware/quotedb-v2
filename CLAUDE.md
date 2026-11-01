# CLAUDE.md

Guidance for Claude Code when working in this repository.

## Project

QuoteDB v2: a TypeScript rewrite of the Laravel QuoteDB app (`../quotedb`). The plan and its rationale live in `docs/MIGRATION.md`; §7 "Locked-in stack" and §9 "Implementation notes" are authoritative where older sections disagree.

pnpm workspace:

- `apps/api` — Fastify 5 + TypeBox 1.x + Drizzle + Postgres 17. Email/password login with opaque session cookies; feature-scoped personal access tokens. OpenAPI at `/api/documentation`.
- `apps/web` — user app (React 19, Vite 8, TanStack Router/Query, Tailwind 4, react-hook-form).
- `apps/admin` — admin app, same stack, separate deploy at `admin.<domain>`; shares the session via an apex-scoped cookie.
- `apps/site` — Astro static landing page.
- `packages/shared` — TypeBox schemas, scope/role constants, typed API client. Used by the API *and* both frontends: change a schema here and both sides follow.
- `packages/ui` — shadcn-style components, theme CSS, and `typeboxResolver` for react-hook-form.
- `e2e` — Playwright happy paths (one per app).
- `infra` — OpenTofu (single DigitalOcean Droplet: API, PostgreSQL, and all frontend sites; Cloudflare DNS), Dockerfiles, the server's compose stack and deploy/ops-check scripts, self-host stack. See `infra/README.md`.

## Commands

Node comes from nvm (`.nvmrc`, Node 24); pnpm via corepack (`packageManager` in `package.json`).

```bash
pnpm install
docker compose up -d          # Postgres 17 + Mailpit (ports overridable: POSTGRES_PORT, MAILPIT_*_PORT)
cp .env.example .env          # then set COOKIE_SECRET
pnpm db:migrate && pnpm db:seed
pnpm dev                      # api :3000, web :5180, admin :5181, site :4322

pnpm typecheck                # tsc -b (project references) + astro check
pnpm lint                     # Biome; `pnpm format` to fix
pnpm test                     # Vitest: shared, ui, api (api uses Testcontainers → needs Docker)
pnpm --filter @quotedb/api test -- -t "rate-limits"   # single test by name
pnpm test:e2e                 # Playwright; needs `docker compose up` Postgres
pnpm build
```

Seeded dev logins: `admin@quotedb.local` / `izaro@quotedb.local`, password `quotedb-dev-password`.

E2E on a machine without Chromium's system libraries (e.g. WSL without sudo): run the browser in Docker and point Playwright at it:

```bash
docker run -d --rm --name qdb-pw -p 3333:3333 --init mcr.microsoft.com/playwright:v1.64.1-noble \
  npx -y playwright@1.64.1 run-server --port 3333 --host 0.0.0.0
PW_TEST_CONNECT_WS_ENDPOINT=ws://127.0.0.1:3333/ PW_TEST_CONNECT_EXPOSE_NETWORK='<loopback>' pnpm test:e2e
```

## Database

- Schema: `apps/api/src/db/schema.ts` (Drizzle, `casing: 'snake_case'`). After changing it run `pnpm --filter @quotedb/api db:generate --name <change>` and commit the SQL in `apps/api/drizzle/`.
- Production runs `node dist/migrate.js` in a one-off container before each deploy swaps containers (`infra/droplet/deploy.sh`).
- UUID primary keys; `external_id` keeps v1 integer ids. Soft deletes via `deleted_at` — always filter `isNull(deletedAt)` explicitly (no global scopes).

## API conventions

- Identity comes from the auth context only (`request.auth`), never from body/path. `authOf(request)` inside guarded handlers.
- Every route declares its guard: `requireScope('quotes:read')` (sessions pass, tokens need the scope), `requireSession` (tokens rejected: token management, password change, admin), `requireAdmin`.
- Other users' resources are 404, not 403.
- Request/response schemas come from `@quotedb/shared`; responses are serialized through them, so extra fields are stripped.
- State-changing cookie requests must carry an allowed `Origin`/`Referer` (`WEB_URL`, `ADMIN_URL`, `APP_URL`). Bearer-only requests are exempt. Tests send `origin` by default via `ctx.request`.
- Rate limits: 100/min keyed by token → user → IP; login 5/15 min per email; forgot-password 3/hour per email.
- Never log secrets: log `token.prefix`, never the token; Pino redacts auth headers and cookies.
- The app reads only the env contract in `apps/api/src/env.ts` — never platform-specific variables.

## Tests

- API tests hit a real Postgres (Testcontainers), never mocks. `test/global-setup.ts` migrates a template DB once; `setupTestApp()` clones it per test file and returns helpers (`createUser`, `login`, `createToken`, `createQuote`, `request`).
- Mail goes to an in-memory outbox (`ctx.mailer.outbox`); HIBP is stubbed (`ctx.setBreachChecker`).

## Style

- Biome formats (single quotes, no semicolons, 100 cols). TypeScript 7 everywhere except `apps/site`, which pins TypeScript 6 only because `astro check` doesn't support 7 yet.
- Workspace packages ship TypeScript source (`exports` → `src/index.ts`); the API is bundled with esbuild (`apps/api/build.mjs`) so `@quotedb/*` is inlined.
- TypeBox is v1 (`import Type from 'typebox'`), not `@sinclair/typebox`.
