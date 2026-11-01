import { randomBytes } from 'node:crypto'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import postgres from 'postgres'
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { migrate } from '../src/db/migrations.js'
import { decrypt, encrypt } from '../src/security/credentials.js'

let container: StartedPostgreSqlContainer
let sql: postgres.Sql
const oldKey = randomBytes(32)
const newKey = randomBytes(32)
let originalExitCode: typeof process.exitCode

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:17').start()
  sql = postgres(container.getConnectionUri(), { max: 1, onnotice: () => {} })
  await migrate(sql)
})
afterAll(async () => {
  await sql?.end()
  await container?.stop()
})
beforeEach(async () => {
  originalExitCode = process.exitCode
  process.exitCode = undefined
  vi.resetModules()
  vi.stubEnv('BOT_DATABASE_URL', container.getConnectionUri())
  vi.stubEnv('BOT_PREVIOUS_ENCRYPTION_KEY', oldKey.toString('hex'))
  vi.stubEnv('BOT_ENCRYPTION_KEY', newKey.toString('hex'))
  vi.spyOn(console, 'info').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  await sql`truncate discord_bot.guild_settings`
  for (const guild of ['a', 'b', 'disconnected']) {
    const credential = guild === 'disconnected' ? null : encrypt(oldKey, guild, `secret-${guild}`)
    await sql`insert into discord_bot.guild_settings (guild_id,credential,revision,updated_by)
      values (${guild},${credential},'original','admin')`
  }
})
afterEach(() => {
  process.exitCode = originalExitCode
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

it('rotates every connected guild, preserves plaintext and leaves disconnected guilds alone', async () => {
  await import('../src/rotate-key.js')
  const rows = await sql`select * from discord_bot.guild_settings order by guild_id`
  for (const row of rows.filter((row) => row.credential !== null)) {
    expect(decrypt(newKey, row.guild_id, row.credential)).toBe(`secret-${row.guild_id}`)
    expect(() => decrypt(oldKey, row.guild_id, row.credential)).toThrow()
    expect(row.revision).toBe('original')
  }
  expect(rows.find((row) => row.guild_id === 'disconnected')?.credential).toBeNull()
  expect(process.exitCode).toBeUndefined()
  expect(console.error).not.toHaveBeenCalled()
})

it('rolls back all credentials if one guild has corrupted ciphertext', async () => {
  await sql`update discord_bot.guild_settings set credential='corrupted-secret' where guild_id='b'`
  const before =
    await sql`select guild_id,credential from discord_bot.guild_settings order by guild_id`
  await import('../src/rotate-key.js')
  expect(
    await sql`select guild_id,credential from discord_bot.guild_settings order by guild_id`,
  ).toEqual(before)
  expect(process.exitCode).toBe(1)
  expect(console.info).not.toHaveBeenCalled()
  expect(console.error).toHaveBeenCalledWith(expect.stringContaining('rolled back'))
  expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain('corrupted-secret')
})

it('rejects malformed replacement keys before modifying credentials', async () => {
  vi.stubEnv('BOT_ENCRYPTION_KEY', 'not-a-key')
  const before = await sql`select credential from discord_bot.guild_settings order by guild_id`
  await import('../src/rotate-key.js')
  expect(await sql`select credential from discord_bot.guild_settings order by guild_id`).toEqual(
    before,
  )
  expect(process.exitCode).toBe(1)
})
