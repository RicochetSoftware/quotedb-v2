import type postgres from 'postgres'

export async function migrate(sql: postgres.Sql) {
  await sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(71422908)`
    await tx`create schema if not exists discord_bot`
    await tx`create table if not exists discord_bot.guild_settings (
      guild_id text primary key, credential text, owner_id uuid, owner_name text, token_prefix text,
      revision text not null, updated_by text not null,
      creator_roles jsonb not null default '{"mode":"all","ids":[]}',
      channels jsonb not null default '{"mode":"all","ids":[]}',
      updated_at timestamptz not null default now()
    )`
    await tx`alter table discord_bot.guild_settings add column if not exists collection_id uuid`
    await tx`alter table discord_bot.guild_settings add column if not exists collection_name text`
    await tx`create table if not exists discord_bot.invocations (
      id text primary key, guild_id text not null, quote_id uuid, created_at timestamptz not null default now()
    )`
    await tx`create index if not exists invocations_created_idx on discord_bot.invocations (created_at)`
  })
}
