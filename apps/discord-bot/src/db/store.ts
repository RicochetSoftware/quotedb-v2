import { randomUUID } from 'node:crypto'
import postgres from 'postgres'

export interface Policy {
  mode: 'all' | 'selected'
  ids: string[]
}
export interface Settings {
  guild_id: string
  credential: string | null
  collection_id: string | null
  collection_name: string | null
  token_prefix: string | null
  revision: string
  creator_roles: Policy
  channels: Policy
}
export const everyone = (): Policy => ({ mode: 'all', ids: [] })

export function createStore(url: string) {
  const sql = postgres(url, { max: 2, connect_timeout: 5, idle_timeout: 20, onnotice: () => {} })
  return {
    async get(guild: string): Promise<Settings> {
      const [row] = await sql<
        Settings[]
      >`select * from discord_bot.guild_settings where guild_id = ${guild}`
      return (
        row ?? {
          guild_id: guild,
          credential: null,
          collection_id: null,
          collection_name: null,
          token_prefix: null,
          revision: 'unconfigured',
          creator_roles: everyone(),
          channels: everyone(),
        }
      )
    },
    async connect(
      guild: string,
      actor: string,
      credential: string,
      collection: { id: string; name: string },
      prefix: string,
      expected: string,
    ) {
      // Compare-and-swap also covers simultaneous first-time setup confirmations.
      const rows = await sql`insert into discord_bot.guild_settings
        (guild_id, credential, collection_id, collection_name, token_prefix, revision, updated_by)
        select ${guild}, ${credential}, ${collection.id}, ${collection.name}, ${prefix}, ${randomUUID()}, ${actor}
        where ${expected} = 'unconfigured'
        on conflict (guild_id) do nothing returning guild_id`
      if (rows.length) return true
      const updated =
        await sql`update discord_bot.guild_settings set credential=${credential}, collection_id=${collection.id},
        collection_name=${collection.name}, token_prefix=${prefix}, revision=${randomUUID()}, updated_by=${actor}, updated_at=now()
        where guild_id=${guild} and revision=${expected} returning guild_id`
      return updated.length > 0
    },
    async policy(guild: string, actor: string, kind: 'creator_roles' | 'channels', policy: Policy) {
      await sql`insert into discord_bot.guild_settings (guild_id, revision, updated_by)
        values (${guild}, ${randomUUID()}, ${actor}) on conflict do nothing`
      await sql`update discord_bot.guild_settings set ${sql(kind)}=${sql.json({ ...policy })},
        revision=${randomUUID()}, updated_by=${actor}, updated_at=now() where guild_id=${guild}`
    },
    async disconnect(guild: string, actor: string) {
      await sql`update discord_bot.guild_settings set credential=null, collection_id=null, collection_name=null,
        token_prefix=null, revision=${randomUUID()}, updated_by=${actor}, updated_at=now() where guild_id=${guild}`
    },
    async claim(guild: string, id: string) {
      await sql`delete from discord_bot.invocations where created_at < now() - interval '7 days'`
      const rows =
        await sql`insert into discord_bot.invocations (id, guild_id) values (${id}, ${guild})
        on conflict do nothing returning id`
      return rows.length > 0
    },
    async complete(id: string, quoteId: string) {
      await sql`update discord_bot.invocations set quote_id=${quoteId} where id=${id}`
    },
    async health() {
      await sql`select 1 from discord_bot.guild_settings limit 1`
    },
    close: () => sql.end({ timeout: 5 }),
  }
}
export type Store = ReturnType<typeof createStore>
