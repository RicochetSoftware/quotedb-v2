# QuoteDB v2

[![Build](https://github.com/RicochetSoftware/quotedb-v2/actions/workflows/ci.yml/badge.svg?branch=master)](https://github.com/RicochetSoftware/quotedb-v2/actions/workflows/ci.yml)
[![Unit-test line coverage](.github/badges/coverage.svg)](#checks)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![Node.js: >=24](https://img.shields.io/badge/node-%3E%3D24-339933?logo=node.js&logoColor=white)](package.json)

The Elmu Quote Database, rebuilt as a TypeScript monorepo: a Fastify API on Postgres, React apps for users and admins, an Astro landing page, and all of the hosting defined as code.

| Package | What | Dev URL |
|---|---|---|
| `apps/api` | Fastify + TypeBox + Drizzle + Postgres 17 | http://localhost:3000 (docs: `/api/documentation`) |
| `apps/web` | User app: quotes, random, settings, API tokens | http://localhost:5180 |
| `apps/admin` | Admin app: dashboard, users, quotes | http://localhost:5181 |
| `apps/site` | Static landing page (Astro) | http://localhost:4322 |
| `apps/discord-bot` | Discord quotes bot ([setup](apps/discord-bot/README.md)) | `pnpm dev:discord` |
| `packages/shared` | TypeBox schemas + typed API client | |
| `packages/ui` | Shared UI components and theme | |
| `e2e` | Playwright happy paths | |
| `infra` | OpenTofu (single DigitalOcean Droplet + Cloudflare DNS), Dockerfiles, server stack, self-host stack | |

## Getting started

Requires Node 24 (`nvm use`), pnpm via corepack (`corepack enable`), and Docker.

```bash
pnpm install
docker compose up -d                  # Postgres 17 + Mailpit (UI on :8025)
cp .env.example .env                  # set COOKIE_SECRET: openssl rand -base64 48
pnpm db:migrate && pnpm db:seed
pnpm dev
```

Then sign in at http://localhost:5180 as `izaro@quotedb.local` using an email code from Mailpit. Run `node scripts/admin-dev.mjs` and restart dev servers to enable local admin access. See [authentication and deployment](docs/AUTH.md).

## Checks

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
pnpm test:e2e
pnpm test:coverage                    # needs Docker; refreshes the coverage badge
```

The build badge tracks CI on `master`, including browser tests. The coverage badge is a
checked-in snapshot of combined unit/integration **line coverage**, weighted by executable
lines across the API, Discord bot, shared package, and UI library. It excludes the web/admin
apps, Astro site, infrastructure, and the bot's startup, migration, and command-registration
entry points. Browser tests do not contribute to this percentage.

Run `pnpm test:coverage` and commit `.github/badges/coverage.svg` to refresh the snapshot.
CI runs the same command and uploads the current summaries and badge as the `unit-coverage`
artifact on each run; it does not commit badge changes automatically.

## License

Licensed under the [MIT License](LICENSE).

## Using the API from scripts

Create a token under **Settings → API tokens** and pick only the scopes it needs (`quotes:read`, `quotes:write`, `profile:read`). The full token is shown once.

```bash
curl -H "Authorization: Bearer qdb_live_…" https://api.<domain>/api/v1/quotes/random?max=3
curl -H "Authorization: Bearer qdb_live_…" -H 'content-type: application/json' \
  -d '{"quote":"…","author":"…","date":"2024-01-31"}' https://api.<domain>/api/v1/quotes
```

Quotes belong to personal or shared collections. Use **Manage collections** to create a shared collection, manage members, and issue collection integration tokens for Discord. Personal tokens remain account-bound; integration tokens belong to one collection and survive issuer departure. Neither token kind can manage tokens or reach `/admin`. The v1 routes `/api/v1/quotes/{search,random}/user/:id?max_quotes=N` still work for your own user id (legacy integer or UUID) until the v2 release.

See [collections and migration](docs/COLLECTIONS.md) for roles, API selection, and upgrading existing bot connections.

## Docs

- `docs/MIGRATION.md`: architecture, decisions and the phased plan. §9 records how the implementation differs from the plan.
- `infra/README.md`: deploy runbook (one-time manual steps, first `tofu apply`, CI secrets, exit plan).
- `CLAUDE.md`: conventions for working in the codebase.
