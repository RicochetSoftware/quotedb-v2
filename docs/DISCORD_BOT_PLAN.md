# Discord quotes bot implementation plan

Status: implementation added; automated verification and private-server acceptance status are recorded below.
Date: 2026-11-01.

This document records the agreed product scope and a proposed implementation for
`apps/discord-bot`. Implementation details marked as proposals are working defaults,
not additional requirements approved by the user.

> **Collection model update (2026-11-01):** [COLLECTIONS.md](COLLECTIONS.md) supersedes
> the account ownership and personal-key design below. Each guild now connects to a
> shared collection with a collection-owned integration token. Historical planning
> sections remain here for context; use the bot README for current setup instructions.

## 1. Goal and agreed scope

Run a quotes bot in one private Discord server initially, alongside the existing
QuoteDB deployment. One shared QuoteDB collection contains the server’s quotes. Discord members do not need individual QuoteDB accounts.

- Each server connects to exactly one shared collection using a collection integration token.
- Discord admins manage the connection through the bot.
- Random quotes default to five, with an optional count.
- `/izaro` posts one random Izaro quote from QuoteDB's public featured collection.
- List and search show five quotes per page with Previous/Next buttons, newest first.
- Search supports text and an optional author filter.
- Everyone can create by default; admins can restrict creation to selected roles.
- Commands work everywhere by default; admins can configure allowed channels.
- Manual creation accepts any author text and defaults to the invoking member's
  server display name. Its date defaults to today.
- Replying to a message and mentioning the bot saves the original message as a quote.
- A message context-menu action, **Apps → Save quote**, provides the same capture flow.
- Captured quotes use the original author's server display name and message date.
- Successful quote responses and creation confirmations are public in the channel.
- Setup, API-key entry, and administrative settings are private responses.
- Embeds follow the supplied screenshots: beige accent, title, bold italic quote
  text, author line, and a footer with bot identity, QuoteDB site, and timestamp.

The earlier idea of selecting among several owners within a server is superseded:
one server maps to one collection. The data model may key settings by guild ID without
making public distribution or multiple-server operation part of the initial release.

## 2. Foundation at planning time

At planning time, the scaffold contained Node 24, TypeScript, discord.js, environment
validation, client creation, shutdown handling, and an esbuild ESM build.
`pnpm dev:discord` starts it separately from the other apps. Root build/typecheck
include it. Command handling, registration, persistence, and bot tests had not yet been added.

Relevant repository files:

- `apps/discord-bot/src/{index,client,env}.ts`: current startup scaffold.
- `packages/shared/src/client.ts`: shared typed API client; currently cookie-oriented.
- `packages/shared/src/schemas/quotes.ts`: quote types, limits, query schemas.
- `apps/api/src/modules/quotes/routes.ts`: owner-scoped quote operations.
- `apps/api/src/modules/auth/routes.ts`: `/me` requires `profile:read`.
- `apps/api/src/db/schema.ts`: quotes, users, and hashed personal API tokens.
- `infra/droplet/compose.yaml`: PostgreSQL, API, and Caddy production services.
- `infra/docker/api.Dockerfile`: pattern for a production Node image.
- `.github/workflows/deploy.yml`, `infra/droplet/deploy.sh`, and
  `infra/droplet/release.sh`: existing image/release pipeline.
- `infra/droplet/backup.sh`: existing QuoteDB PostgreSQL dump.

Existing API behavior already provides ownership isolation, soft-delete filtering,
quote creation with an optional timestamp, random selection, and text/author search.
Author filtering is case-insensitive exact matching; text search matches quote text
or author. List currently returns at most 1,000 results with no pagination.
Quotes permit 5,000 characters and authors 255 characters.

## 3. Command design

Command spelling and optional limits below are proposed implementation defaults.

| Action | Interface | Behavior |
|---|---|---|
| Random | `/quote random [count]` | Default 5; proposed range 1–20; return available quotes without padding or duplicates within the selection |
| Izaro | `/izaro` | Return one random quote from the existing public Izaro endpoint |
| List | `/quote list` | Most recent quotes, five per page |
| Search | `/quote search text [author]` | Search text plus optional exact author filter, five per page |
| Manual creation | `/quote create` | Open a form for quote text, author, and optional date |
| Capture reply | Reply to a message and mention the bot | Save the referenced message, not the invoking reply |
| Capture message | **Apps → Save quote** | Save the selected message |
| Connect/rotate key | `/quote setup` | Admin-only private API-key form and account confirmation |
| Configure | `/quote settings` | Admin-only private role/channel configuration and connection status |
| Disconnect | Settings action | Explicit confirmation, remove saved credential, keep existing quotes |

Use server-only application commands. Direct messages are unsupported. Register
commands in the configured private guild during initial rollout; provide an explicit
registration script rather than rewriting command registrations on every reconnect.
Admin authorization must be enforced in handlers even if Discord command visibility
also limits access. With admin and member subcommands sharing `/quote`, do not rely
on root-command permissions to distinguish them.

### Izaro command

Register `/izaro` as a standalone server-only slash command with no arguments. Call
`GET /api/v1/public/izaro` through the existing shared client's `public.izaro()` method,
using a client without a server account's Bearer token. The API's `IZARO_USER_ID`
configuration selects the collection; do not search for an author named Izaro or use
the server's linked owner account.

Post one quote publicly using the shared beige embed style, titled **Random Izaro
Quote**, preserving the returned quote text, author, and date. Apply the same escaping,
mention suppression, and long-text fallback as other quote responses. Request a fresh
selection on every invocation; consecutive calls may legitimately return the same quote.

This command works without a linked QuoteDB account and remains available if the
server's account key is revoked. It still obeys the configured allowed-channel policy,
normal read-command cooldowns, and the initial guild allowlist. Creator-role restrictions
do not apply. Return a friendly unavailable/empty message for the endpoint's 404 response
and handle API outages or rate limits through the standard error handling.

### Manual creation

Open a modal with quote text, author prefilled from the member's server display name,
and an optional ISO date. Use global display name, then username, if a server display
name is unavailable. Preserve internal whitespace and line breaks; reject empty or
whitespace-only text and authors. Validate against shared API limits.

The current Discord form/input limits must be checked during implementation. If a
single input cannot accept the API's full 5,000-character quote, advertise and enforce
the smaller manual-entry limit; do not silently truncate saved text. Existing longer
quotes still need to be readable through the bot's output fallback.

### Message capture

Resolve the original message and its author in the same server. Store its text,
resolved display name, and original timestamp through the normal quote API. Names
are snapshots: later nickname changes do not rewrite stored quotes.

- Save the message's text; do not save the bot mention or reply instruction.
- Ignore bot-authored trigger messages to prevent loops. Reject capturing the bot's
  own confirmation messages; other bot-authored text may be captured deliberately.
- If the original is missing, inaccessible, or textless, explain that it cannot be saved.
- Attachments, stickers, OCR, and embed extraction are outside the initial scope.
- A mention without a reply gives brief usage guidance and creates nothing.
- Normalize user/channel mention tokens into readable text where resolvable, with a
  stable textual fallback. Never allow captured mentions to ping anyone in output.
- Check permissions for both the invocation channel and source channel; do not relay
  content from a source the invoker cannot access.
- Proposed date handling: pass the original UTC ISO timestamp unchanged. Manual
  omitted dates use API creation time; explicit dates use the existing API UTC rules.

## 4. Presentation and pagination

Reference screenshots supplied from
`C:\Users\ElmuK\Documents\ShareX\Screenshots\2026-11`:

- `Discord_J7d7K7Z8q2.png`: recent quote/list presentation.
- `Discord_dUXdhOmxo8.png`: creation confirmation.
- `Discord_uLpyvLsXNv.png`: five random quotes in one response.

Use one consistent renderer for all retrieval and creation paths. Suggested titles:
**Random Quotes**, **Recent Quotes**, **Search Results**, and **New Quote Created**.
Use a beige accent, readable spacing, bold italic quote text, and a separate author
line. Footer branding uses the actual bot name/avatar and configured public site URL;
copying the old bot's name or broken footer image is not required.

For single quotes, use the quote timestamp; for grouped results, use response time
and label individual dates where needed. Escape user text so Markdown cannot break
the layout. Set `allowedMentions` to disable all generated pings, including reply pings.

Do not assume five maximum-length quotes fit in an embed. Budget text against current
Discord limits, truncate display previews visibly, and offer a full-text attachment
when necessary. Stored quotes must remain complete. Long random selections use pages
of five from one fixed random selection, not a new random draw on each click.

Proposed pagination behavior:

- Only the initiating member can turn a public result's pages; other members can run
  their own command. Unauthorized button clicks receive a private explanation.
- Store short-lived page sessions keyed by opaque random IDs. Include guild, channel,
  initiating user, query, connection version, expiry, and cursor history.
- Recheck channel policy and server connection on each click; reject cross-guild,
  expired, forged, or stale sessions. A changed/disconnected account invalidates them.
- Disable Previous on the first page and Next when exhausted. Show page number without
  inventing a total count that the API has not supplied.
- Proposed expiry: ten minutes. Expired/restarted sessions ask the user to rerun the
  command; retained public results remain visible. Disable buttons when practical.
- Serialize concurrent clicks per result to avoid out-of-order edits.

Empty collections and no-match searches receive clear messages. Ordinary failures
should be private for interactions where possible. Reply-triggered errors are public
because message events do not support ephemeral responses. Successful quote output
remains public in all three creation paths.

## 5. Server setup and permissions

### Connection flow

1. A Discord administrator runs `/quote setup`.
2. Open a modal for an existing QuoteDB API key; never accept a key as a public slash
   option or ordinary channel message. Discord receives the modal submission, so this
   is private within the server, not end-to-end secret entry.
3. Validate the key against the configured QuoteDB API, including required scopes,
   expiry/revocation, and owner identity. Do not create a throwaway quote to test access.
4. Show the owner identity privately and ask for confirmation before connecting or
   replacing an existing owner. Explain that the server can read that owner's quotes
   and permitted members can add quotes to that account.
5. Encrypt and persist the key atomically. On validation failure, keep the old working
   connection. Discard abandoned pending submissions after a short timeout.
6. Confirm privately using only a safe token prefix and owner display name.

API keys continue to be issued/revoked through QuoteDB. The bot does not create users
or obtain account passwords. Replacing or disconnecting a key does not migrate or
remove quotes, and disconnecting does not revoke the token in QuoteDB.

### Settings defaults and behavior

| Setting | Default | Proposed implementation |
|---|---|---|
| Creator roles | Everyone | Explicit mode: everyone or selected role IDs |
| Allowed channels | Everywhere | Explicit mode: everywhere or selected channel IDs |
| Admin eligibility | Discord administrator | Server owner or Administrator permission, checked on every action |

An empty restricted list must never accidentally mean everyone/everywhere. Deleted
roles/channels remain restrictive until an admin repairs settings. Admin settings stay
accessible outside allowed quote channels to prevent lockout. Admins may bypass the
creator-role restriction, but ordinary quote output still obeys channel restrictions.
Proposed thread rule: allow a thread when it or its parent channel is allowed, subject
to actual Discord visibility and bot permissions. Show effective settings before save.

Authorization is based on the member invoking the action, not the quoted author.
Creating through reply, context menu, modal submission, and slash paths must use the
same policy checks. Recheck on submission after a modal has been open.

## 6. API integration and required changes

Server collection reads and writes go through the existing API with the linked account's
Bearer token. `/izaro` uses the existing public endpoint without authentication and
requires no new quote API route. The bot never directly writes quote/user/token tables or sends an owner
ID to override token identity.

### Shared client

Extend `createApiClient` with optional server-side Bearer authentication and request
cancellation/timeouts, preserving existing browser cookie behavior. Instantiate the
client per guild/request context; do not use a mutable global authorization header.
Never log tokens, request authorization headers, or raw setup interaction payloads.
When importing workspace TypeScript, update the bot build to bundle workspace packages
while leaving third-party dependencies external, following the API build convention.

### Token validation

Proposed additive endpoint: `GET /api/v1/token-info`, authenticated by a valid personal
API token. Return minimal owner identity, safe prefix, granted scopes, and expiry.
Do not return the secret/hash or expose token-management capabilities. Reject cookie
sessions if this endpoint is token-only. Require normal token validity and rate limits,
but no extra profile scope merely to inspect the caller's own credential.

The bot requires `quotes:read` and `quotes:write`. Existing `/me` alone cannot validate
both scopes and additionally requires `profile:read`; use the new endpoint to avoid
requiring unnecessary profile access or probing permissions through writes.

### Real pagination

Extend list/search with an optional cursor and additive next-cursor response metadata.
Keep existing callers, `max`, filters, and the `quotes` array compatible. Use a stable
`created_at DESC, id DESC` order and an opaque validated cursor containing the last
sort values. Bot requests `max=5`; fetch one extra row to determine continuation.
Bind all queries to the authenticated owner, including cursor queries.

The bot keeps cursor history for Previous. Do not fetch only the first 1,000 quotes
and pretend they are the complete collection. Test ties in timestamps, backdated
quotes, filter combinations, invalid cursors, deleted rows, and owner isolation.
Live list/search need not be a historical snapshot: edits/deletions may affect later
pages. Random pagination retains the initial selection for its short session.

### Failure handling

Set bounded request timeouts. Map invalid/revoked keys, missing scopes, rate limits,
validation failures, and API outages to actionable responses. Respect retry timing
and apply short per-user/guild cooldowns so a shared account does not exhaust its API
limit. Retry safe reads only within a small bounded budget. Do not automatically retry
quote creation after an ambiguous network failure: it may already have succeeded.
Explain uncertainty and suggest checking recent quotes before submitting again.

## 7. Persistence and credential security

Proposed storage: a bot-owned PostgreSQL schema in the existing QuoteDB database,
accessed through a dedicated database role with access only to that schema. This
reuses existing database hosting and logical backups. Quote operations still use HTTP;
the bot's database access is solely for its own configuration and operational state.
Use a small connection pool appropriate to the deployment's 30-connection limit.

Proposed tables:

- `guild_settings`: guild ID (text primary key), linked owner UUID/name, encrypted key,
  safe token prefix, encryption-key version, connection revision, creator policy,
  allowed-channel policy, updated-by Discord ID, and timestamps.
- `processed_invocations`: guild ID, Discord event/interaction ID, state, resulting
  quote ID when known, and expiry; unique invocation ID prevents concurrent replay.

Store Discord snowflakes as strings, not JavaScript numbers. Use migrations owned by
`apps/discord-bot`, run once during release. Provision the schema/runtime role through
an explicit deployment bootstrap step; give migration credentials only to that step.
Keep bot tables out of the API's application schema migration ownership.

Encrypt API keys using authenticated encryption (proposed AES-256-GCM), unique random
nonces, and associated data binding the ciphertext to the guild and key version. Store
the encryption key separately in deployment secrets, not in the database. Validate
configuration at startup; never silently generate a replacement key after a restart.
Document key rotation and preserve the old key until all records are re-encrypted.

Backups must include the bot schema and role/bootstrap restoration instructions.
Restoring ciphertext also requires the separately retained encryption secret. Test a
backup restore and decryption before calling deployment complete.

Invocation deduplication covers repeated delivery of the same event, not deliberate
saving of the same source message through separate commands. A crash between API
success and local completion is an ambiguous outcome; do not claim exactly-once writes
without API-side idempotency. Mark uncertain operations and avoid automatic replay.
Do not retain captured message bodies in operational tables or logs.

## 8. Discord platform requirements

Use a long-running Gateway client; no new public HTTP ingress is needed. Enable
`Guilds`, `GuildMessages`, and `MessageContent` intents for reply capture. The privileged
Message Content intent must also be enabled in the Developer Portal. Mentioned and
context-menu target messages have content exceptions, but those do not guarantee access
to an arbitrary original message referenced by a reply. See the official
[Gateway intent documentation](https://github.com/discord/discord-api-docs/blob/main/developers/events/gateway.mdx).

Install with bot/application-command scopes. Request only required channel permissions:
View Channel, Send Messages, Embed Links, Read Message History, Attach Files for long
quote output, and Send Messages in Threads where thread use is supported. Do not
request Administrator or blanket GuildMembers access for ordinary display-name lookup.

Acknowledge or defer interactions promptly, before API/database work. Discord requires
an initial response within three seconds and interaction tokens last fifteen minutes.
Open a modal as the initial response, then defer its submission while validating.
See [interaction responses](https://github.com/discord/discord-api-docs/blob/main/developers/interactions/receiving-and-responding.mdx)
and [modal handling](https://discordjs.guide/guide/interactions/modals).

Check current embed, component, input, and attachment constraints during implementation
and centralize them in the renderer/validation layer. Handle inaccessible channels,
deleted responses, expired interactions, reconnects, and insufficient send permissions
without crashing the process or leaking raw errors.

## 9. Proposed application layout

```text
apps/discord-bot/
  src/
    index.ts                 # startup, health state, shutdown
    client.ts                # Gateway client and event wiring
    env.ts                   # validated deployment contract
    commands/                # command definitions and registration script
    handlers/                # slash, context menu, message, modal, button adapters
    services/                # quote operations and guild connection lifecycle
    policies/                # admin, creator-role, channel authorization
    presentation/            # embeds, long-text fallback, pagination
    api/                     # guild-bound shared client construction
    db/                      # configuration repository and schema
    security/                # key encryption and redaction
    migrate.ts               # bot schema migration entry point
  migrations/
  test/
  build.mjs
  vitest.config.ts
  README.md
```

Keep Discord adapters thin. Resolve guild/policy context once, delegate to services,
and render results through shared presentation code. Use dependency injection for
API/database/clock boundaries to make failure paths testable without a live bot.

Proposed environment contract: `DISCORD_BOT_TOKEN`, `DISCORD_APPLICATION_ID`,
`DISCORD_GUILD_ID` (initial guild allowlist/registration target), `QUOTEDB_API_URL`,
`QUOTEDB_PUBLIC_URL`, `BOT_DATABASE_URL`, `BOT_ENCRYPTION_KEY`, and `LOG_LEVEL`.
Never permit guild admins to redirect the API base URL to an arbitrary host.

## 10. Deployment and operations

Add `infra/docker/discord-bot.Dockerfile`, using the existing Node 24 multi-stage
build/deploy pattern and non-root runtime. Add a third, commit-tagged GHCR image to
the production release. Extend Compose, deploy/release/rollback scripts, workflow
inputs, environment examples, and the infrastructure runbook together.

- Run one bot instance initially with a restart policy and graceful shutdown.
- Use the internal API URL (`http://api:8080`) and existing PostgreSQL service.
- Supply a restricted bot environment file containing Discord/database/encryption
  credentials through the deployment secret-delivery mechanism; never embed it in images.
- Provision schema/role and apply bot migrations before starting the new image.
- Retain backward-compatible schema changes so an image rollback remains possible.
- Start after dependencies are healthy, but tolerate later API/database outages.
- Expose container-local health state for Discord readiness, database access, and API
  availability without publishing a host port. Distinguish temporary reconnects from
  fatal startup/configuration errors.
- Measure memory/CPU before setting limits: the current deployment targets a small
  shared Droplet, so do not assume spare capacity or run a large default cache/pool.
- Include bot settings in backup/restore checks and add bot status to ops checks.
- Update self-host documentation/Compose as an optional bot service if that deployment
  path is maintained; existing deployments without Discord secrets must remain usable.

Logs should include action, guild ID, request/event ID, duration, outcome, and safe
error category. Exclude quote bodies and secrets. Audit admin changes with actor IDs.
Keep command registration a documented release/setup action. Failed bot deployment
must not unnecessarily stop the working API or frontends.

## 11. Testing and acceptance

Add a real bot test suite to root `pnpm test`, not a placeholder pass. Use Vitest for
unit/service tests and PostgreSQL integration tests for persistence/migrations.
Discord payload fixtures and mocked transport are suitable for bot adapters; validate
the actual platform behavior separately in a private test server.

| Area | Required checks |
|---|---|
| API client | Bearer isolation across guilds, existing browser behavior, timeouts, error mapping, no secret logging |
| API changes | Token validity/scope introspection, owner isolation, compatible list responses, cursor ordering and filters |
| Setup | Admin-only modal and submit, invalid/read-only/revoked/expired keys, replacement confirmation, failed validation preserves old key |
| Persistence | Restart survival, migrations, encryption round trip, tamper/wrong-key failure, rotation, backup restoration |
| Policies | Everyone defaults, restricted/empty/deleted roles and channels, threads, changed policies during interactions, non-admin denial |
| Commands | Default and bounded random count, search filters, empty collections, manual defaults, API validation failures |
| Izaro | Standalone registration, public endpoint without credentials, works before account setup and after key revocation, channel restrictions, single-quote rendering, 404/rate-limit/outage handling |
| Capture | Correct source text/author/date, both invocation paths, missing/textless messages, ignored triggers, readable non-pinging mentions |
| Output | Screenshot-style structure, escaping, long text/Unicode, embed budgets, full-text fallback, no mentions |
| Pagination | Boundaries, initiating-user rule, expiry/restart, stale account connection, forged buttons, simultaneous clicks |
| Reliability | Duplicate invocation handling, ambiguous create failure, rate limits, outages, reconnect/shutdown |
| Deployment | Image build, secret delivery, migrations, health checks, independent bot rollback |

Manual acceptance in a test guild must exercise setup, all four `/quote` member commands,
standalone `/izaro` both before and after account setup,
both message-capture paths, nickname fallback, original message timestamps, long
quotes, multi-page output, role/channel restrictions, key rotation, revocation, and
a container restart. Verify saved quotes under the linked account in the web app.

Run root typecheck/lint/tests/build and affected browser E2E tests after shared API
changes. Coverage reporting is currently absent; add bot coverage reporting when the
test suite is introduced and establish a measured baseline. Do not claim a percentage
or impose an arbitrary repository-wide threshold in advance of measurement.

## 12. Delivery sequence

1. **API prerequisites:** Bearer-capable shared client, safe token introspection,
   cursor pagination, and compatibility/isolation tests.
2. **Persistent connection:** Bot configuration schema/migrations, encrypted secrets,
   admin setup/settings/disconnect, and policy tests.
3. **Read commands:** Command registration, random/list/search and standalone `/izaro`, shared embeds, long
   output handling, and pagination.
4. **Creation:** Manual modal, reply mention, context menu, display-name/date mapping,
   permissions, deduplication, and failure handling.
5. **Production integration:** Bot image, secrets, migrations, Compose/release/rollback,
   health/backup checks, and operational documentation.
6. **Private-server validation:** Run acceptance checklist, compare presentation with
   screenshots, verify resource usage, then enable the bot in the intended server.

Each phase should leave the existing apps usable and include tests for its behavior.
Completion means all agreed flows work in the intended server, settings survive
restarts, existing app checks pass, and operations can rotate credentials and recover
from a deployment/backup without losing the server connection.

## 13. Outside the first release

Quote editing/deletion commands, per-member QuoteDB linking, multiple owner accounts
per server, cross-server searches, scheduled quotes, reactions/voting, attachments as
quote content, AI features, a web settings dashboard, public bot distribution, and
horizontal scaling are not part of this plan.

Before implementation, resolve only routine defaults that actual API/platform limits
force us to change. Product choices are already captured above; the proposed limits,
admin UI details, persistence architecture, and migration strategy can be refined
without reopening the agreed scope.


## 14. Implementation status

Implemented in the first implementation pass:

- Shared Bearer client, token introspection, and stable cursor pagination preserving
  PostgreSQL microsecond precision.
- Discord slash commands, reply/context-menu capture, setup confirmation, settings,
  encrypted credentials, policies, bounded pagination, and standalone `/izaro`.
- Dedicated PostgreSQL configuration schema/runtime role, invocation deduplication,
  migration entry point, and transactional encryption-key rotation utility.
- Optional production/self-host Compose services, bot image, deployment and rollback
  inputs, health checks, operations checks, and setup/recovery documentation.
- Unit/handler tests and additional real-PostgreSQL API/persistence integration tests.

Implementation details: manual quote forms accept 4,000 characters; capture/API text
accepts 5,000. Runtime page sessions last ten minutes, with a maximum of 1,000 sessions.
Creator/channel selectors support up to 25 entries. Pagination expiry is enforced on
click; expired controls remain visible until the user reruns the command. Formatting
uses readable previews and a complete text attachment for long output.

Not yet validated against live Discord: installation/intents, command registration,
actual modal/context-menu behavior, embed appearance, thread permissions, and live
account setup. Production rollout, resource measurements, and a backup restore drill
also require the configured environment. Do not interpret source implementation as
completion of the private-server acceptance checklist.


Verification from the implementation session:

- Repository typecheck, lint, and all application builds passed.
- 26 bot unit/handler tests, 6 shared-package tests, and 3 UI-package tests passed.
- The bot's unit-only coverage run reported 69.23% lines and 67.34% branches;
  this excludes execution of the PostgreSQL integration test and is not repository coverage.
- Production Compose configuration parsed successfully with the optional bot enabled;
  deployment shell syntax and workflow/Compose YAML parsed successfully.
- The full test command was attempted with a 45-second timeout. API and bot database
  suites could not complete because the local Docker daemon did not respond. These
  tests remain required before deployment, as do the private-server checks above.


Follow-up verification after restarting Docker Desktop (2026-11-01):

- Docker's backend had lost connectivity to its Linux engine while the dashboard
  still reported running. Restarting Docker Desktop and its `docker-desktop` WSL
  instance restored connectivity without deleting containers or volumes.
- Local PostgreSQL and Mailpit are healthy; the bot database migration completed.
- Full `pnpm test` passed: 63 API tests, 27 bot tests, 6 shared-package tests, and
  3 UI-package tests (99 total), including the previously blocked PostgreSQL suites.
- Live Discord acceptance, browser E2E, production rollout, resource measurements,
  and backup restoration remain separate checks.
