# QuoteDB Discord bot

Each allowed Discord server connects to one shared QuoteDB collection. Members can retrieve and
create quotes; Discord administrators manage collection keys, creator roles, and channels.
The complete product/architecture plan is in [DISCORD_BOT_PLAN.md](../../docs/DISCORD_BOT_PLAN.md).

## Local setup

Requires the repository's Node 24/pnpm setup, the API and PostgreSQL, and a Discord
application installed in a test server.

1. Copy the root `.env.example` to `.env` if needed. Configure the bot values without
   overwriting existing application configuration.
2. Set `DISCORD_BOT_TOKEN`, `DISCORD_APPLICATION_ID`, and `DISCORD_GUILD_IDS` (comma-separated server IDs). Enable the
   **Message Content Intent** in the Developer Portal for reply-based capture.
3. Set `QUOTEDB_API_URL` to the local API and `QUOTEDB_PUBLIC_URL` to the user website.
4. Set `BOT_DATABASE_URL` using the `quotedb_bot` username and a strong, URL-encoded
   password. Set `BOT_ENCRYPTION_KEY` to the output of `openssl rand -hex 32`.
5. Start PostgreSQL and migrate both applications. The bot migration uses
   `BOT_MIGRATION_DATABASE_URL`, or the root `DATABASE_URL` as its local fallback,
   to create the restricted database role and bot-owned schema. Only the one-shot
   migration needs database-owner access.

```bash
pnpm install
pnpm db:up
pnpm db:migrate
pnpm --filter @quotedb/discord-bot db:migrate
pnpm --filter @quotedb/discord-bot register
pnpm dev                        # API and web apps, in one terminal
pnpm dev:discord                # bot, in another terminal
```

Install the Discord application with `bot` and `applications.commands` scopes. Give
it View Channel, Send Messages, Embed Links, Attach Files, Read Message History, and
Send Messages in Threads where needed. The bot does not need Administrator permission.

In QuoteDB, open **Manage collections**, create a shared collection (or convert an
existing personal collection), and create an integration token with **quotes:read**
and **quotes:write**. As a Discord administrator, run `/quote setup`, enter the
key in the private form, and confirm the displayed collection. Do not paste keys into
channel messages. `/izaro` works before collection setup when the API has `IZARO_COLLECTION_ID`
(or the legacy `IZARO_USER_ID`) configured and that collection has visible quotes.

Existing connections are upgraded by the bot migration after the API migration:
the old personal collection becomes shared, the account receives a new empty personal
collection, and the bot receives a dedicated collection token. Existing personal tokens
and quotes are preserved. Back up the database and stop the bot before upgrading; the
migration requires the existing encryption key. See [collection migration](../../docs/COLLECTIONS.md).

## Commands

| Command/action | Result |
|---|---|
| `/quote random [count]` | Default 5, range 1–20; pages of five from one selection |
| `/quote list` | Newest first, five quotes per page |
| `/quote search text [author]` | Text search plus optional exact, case-insensitive author filter |
| `/quote create` | Quote/author/date form; author defaults to server display name |
| Reply to a message and mention the bot | Save the original message, author display name, and timestamp |
| Apps → Save quote | Capture the selected message |
| `/izaro` | One random quote from the public Izaro collection |
| `/quote setup` | Administrators: connect or replace the collection key |
| `/quote settings` | Administrators: creator roles, allowed channels, disconnect |

Quote output is public; configuration is private. Everyone can create and all
channels are allowed initially. Restricted empty selections deny access; admins can
always configure the bot and can bypass creator-role restrictions. Threads inherit
allowed parent channels. Channel restrictions also apply to `/izaro`.

Pagination controls belong to the person who ran the command and expire after ten
minutes or a bot restart. Reconfiguration invalidates existing result controls.
Manual input accepts 4,000 characters (Discord's form limit); captured messages/API
quotes can have up to 5,000. Long output includes a complete UTF-8 text attachment.
Captured quotes store a snapshot of the author's display name, not a live user link.

## Development and checks

```bash
pnpm --filter @quotedb/discord-bot test              # includes PostgreSQL Testcontainers
pnpm --filter @quotedb/discord-bot test:coverage
pnpm --filter @quotedb/discord-bot typecheck
pnpm --filter @quotedb/discord-bot build
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

Without Docker, unit/handler tests can be run explicitly, but this does not validate
persistence or the API integration tests:

```bash
pnpm --filter @quotedb/discord-bot exec vitest run test/core.test.ts test/bot.test.ts
```

`start` runs the built output and expects environment variables to be supplied by
the process/container. It does not load `.env`. Registration is an explicit command;
it replaces this application's guild command definitions. The application ID and
guild IDs must belong to the intended servers. The bot must be invited before commands
can be registered there; deployment itself does not require an invitation.

To add a server, add its ID to `DISCORD_GUILD_IDS`, update the deployment configuration,
and restart the bot. Invite it and rerun the registration command, then use `/quote setup`
to connect a collection. Settings and encrypted credentials remain separate per server.
The legacy `DISCORD_GUILD_ID` setting is used when `DISCORD_GUILD_IDS` is empty.

The internal health endpoint listens only on `127.0.0.1:8090`, reports readiness for
Discord/API/database, and is used by the container healthcheck.

## Production

See [infra/README.md](../../infra/README.md#discord-bot). Production uses a separate
non-root bot image, the internal API URL, a restricted PostgreSQL role, and encrypted
per-guild keys. The normal bot container never receives database-owner credentials.
Do not run two instances using the same guild/token during normal operation.

## Recovery and key rotation

QuoteDB API-token rotation: create a replacement key in QuoteDB, run `/quote setup`
and confirm it, verify a command, then revoke the previous key in QuoteDB. A failed
setup leaves the existing connection intact. Disconnect only removes the bot's saved
key; it neither deletes quotes nor revokes the key in QuoteDB.

Encryption-key rotation (different from API-token rotation):

1. Stop the bot so no setup/configuration writes race with rotation.
2. Take a PostgreSQL backup and securely retain the existing encryption key.
3. In a private environment file, set `BOT_PREVIOUS_ENCRYPTION_KEY` to the old value,
   `BOT_ENCRYPTION_KEY` to a newly generated 64-character hex key, and
   `BOT_DATABASE_URL` to the runtime database URL. Do not put keys in shell arguments.
4. Run `node dist/rotate-key.js` in the bot image with that environment. It updates all
   encrypted records in one transaction; failure rolls everything back.
5. Update the normal deployment secret/file to the new key, remove the temporary
   rotation file, and start the bot. Check `/quote list`.

Keep old keys while retaining backups encrypted with them. To restore the database,
provision `quotedb_bot` via migration first (role definitions are not in `pg_dump`),
restore the dump, reapply bot grants/migrations, and supply the encryption key matching
that dump. Test restoration in an isolated database/server before relying on a backup.

Duplicate delivery of one Discord event is suppressed for seven days. A timeout during
quote creation can leave its outcome uncertain; the bot asks users to inspect recent
quotes rather than automatically creating a duplicate. Separate deliberate captures
of the same source message are allowed.
