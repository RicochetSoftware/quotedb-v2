import assert from 'node:assert/strict'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import postgres from 'postgres'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { migrate } from '../src/db/migrations.js'
import { upgradeConnections } from '../src/db/upgrade-collections.js'
import { decrypt, encrypt } from '../src/security/credentials.js'

let container: StartedPostgreSqlContainer
let sql: postgres.Sql
const key = randomBytes(32)
const owner = randomUUID()
const quote = randomUUID()
const raw = `qdb_test_1_${'a'.repeat(32)}`
const hash = createHash('sha256').update('a'.repeat(32)).digest('hex')
beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:17').start()
  sql = postgres(container.getConnectionUri(), { max: 1, onnotice: () => {} })
  for (const statement of (
    await readFile(new URL('../../api/drizzle/0000_init.sql', import.meta.url), 'utf8')
  ).split('--> statement-breakpoint')) {
    if (statement.trim()) await sql.unsafe(statement)
  }
  await sql`insert into users (id,email,name) values (${owner}, 'legacy@test.invalid', 'Legacy server')`
  await sql`insert into quotes (id,user_id,quote,author,created_at,deleted_at) values (${quote},${owner},'Preserved','Author','2020-01-01T12:34:56.123456Z','2021-01-01')`
  await sql`insert into api_tokens (id,user_id,name,prefix,token_hash,scopes) values ('00000000-0000-0000-0000-000000000001',${owner},'Old token','qdb_test_1',${hash},array['quotes:read','quotes:write'])`
  await migrate(sql)
  await sql`insert into discord_bot.guild_settings (guild_id,credential,owner_id,owner_name,revision,updated_by) values ('guild',${encrypt(key, 'guild', raw)},${owner},'Legacy server','original','admin')`
})
afterAll(async () => {
  await sql?.end()
  await container?.stop()
})
it('backfills a populated legacy database and atomically upgrades the bot without changing old secrets or quotes', async () => {
  const original = (
    await sql`select *, created_at::text as precise_date from quotes where id=${quote}`
  )[0]
  for (const statement of (
    await readFile(new URL('../../api/drizzle/0001_collections.sql', import.meta.url), 'utf8')
  ).split('--> statement-breakpoint')) {
    if (statement.trim()) await sql.unsafe(statement)
  }
  assert(original)
  expect((await sql`select * from quotes where id=${quote}`)[0]?.collection_id).toBe(owner)
  expect((await sql`select * from collection_members where collection_id=${owner}`)[0]?.role).toBe(
    'owner',
  )
  await expect(upgradeConnections(sql, randomBytes(32))).rejects.toThrow()
  expect((await sql`select kind from collections where id=${owner}`)[0]?.kind).toBe('personal')
  expect(
    (await sql`select revision from discord_bot.guild_settings where guild_id='guild'`)[0]
      ?.revision,
  ).toBe('original')
  await upgradeConnections(sql, key)
  const settings = (await sql`select * from discord_bot.guild_settings where guild_id='guild'`)[0]
  assert(settings)
  expect(settings.collection_id).toBe(owner)
  expect(settings.owner_id).toBeNull()
  const upgradedRaw = decrypt(key, 'guild', settings.credential)
  expect(upgradedRaw).not.toBe(raw)
  const parts = upgradedRaw.split('_')
  expect(parts).toHaveLength(4)
  expect(parts[3]).toMatch(/^[0-9A-Za-z]{20,64}$/)
  const token = (await sql`select * from api_tokens where kind='collection'`)[0]
  assert(token)
  expect(token.collection_id).toBe(owner)
  expect(token.user_id).toBeNull()
  expect(token.issued_by_user_id).toBe(owner)
  expect(token.token_hash).toBe(
    createHash('sha256')
      .update(parts[3] ?? '')
      .digest('hex'),
  )
  const oldToken = (await sql`select * from api_tokens where kind='personal'`)[0]
  assert(oldToken)
  expect(oldToken.token_hash).toBe(hash)
  expect(oldToken.revoked_at).toBeNull()
  expect(oldToken.collection_id).toBe(owner)
  expect((await sql`select * from collections where id=${owner}`)[0]?.kind).toBe('shared')
  const newPersonal = (await sql`select * from collections where personal_owner_id=${owner}`)[0]
  assert(newPersonal)
  expect(newPersonal.id).not.toBe(owner)
  const preserved = (
    await sql`select *, created_at::text as precise_date from quotes where id=${quote}`
  )[0]
  assert(preserved)
  for (const column of ['id', 'user_id', 'quote', 'author', 'precise_date', 'deleted_at'])
    expect(preserved[column]).toEqual(original[column])
  // New users still get personal collections, and repeating either bot migration is safe.
  const fresh = randomUUID()
  await sql`insert into users (id,email,name) values (${fresh},'fresh@test.invalid','Fresh user')`
  expect(
    (await sql`select personal_owner_id from collections where id=${fresh}`)[0]?.personal_owner_id,
  ).toBe(fresh)
  await migrate(sql)
  await upgradeConnections(sql, key)
  expect(await sql`select * from api_tokens where kind='collection'`).toHaveLength(1)
  expect(
    (await sql`select credential from discord_bot.guild_settings where guild_id='guild'`)[0]
      ?.credential,
  ).toBe(settings.credential)
})
