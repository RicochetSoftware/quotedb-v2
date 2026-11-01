import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { getTableConfig } from 'drizzle-orm/pg-core'
import postgres from 'postgres'
import { afterAll, afterEach, beforeAll, expect, inject, it, vi } from 'vitest'
import * as schema from '../src/db/schema'
import { runMigrations } from '../src/migrate'

let url: string
let sql: ReturnType<typeof postgres>
beforeAll(async () => {
  const admin = postgres(inject('pgAdminUrl'), { max: 1, onnotice: () => {} })
  const name = `operations_${randomUUID().replaceAll('-', '')}`
  await admin.unsafe(`create database ${name}`)
  await admin.end()
  const target = new URL(inject('pgAdminUrl'))
  target.pathname = `/${name}`
  url = target.toString()
  sql = postgres(url, { max: 1, onnotice: () => {} })
})
afterAll(async () => {
  await sql?.end()
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  vi.resetModules()
})

it('applies migrations from the CLI entrypoint and can safely reapply them', async () => {
  const original = process.argv
  process.argv = [
    original[0] ?? 'node',
    fileURLToPath(new URL('../src/migrate.ts', import.meta.url)),
  ]
  try {
    vi.stubEnv('DATABASE_URL', '')
    vi.resetModules()
    await expect(import('../src/migrate')).rejects.toThrow('DATABASE_URL is required')
    vi.resetModules()
    vi.stubEnv('DATABASE_URL', url)
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    await import('../src/migrate')
    expect(log).toHaveBeenCalledWith('migrations applied')
    await runMigrations(url)
    const tables = await sql`select tablename from pg_tables where schemaname = 'public'`
    expect(tables.map((row) => row.tablename)).not.toContain('password_reset_tokens')
    const passwordColumns = await sql`select column_name from information_schema.columns
      where table_schema = 'public' and table_name = 'users'
      and column_name in ('password_hash', 'password_algo')`
    expect(passwordColumns).toEqual([])
    expect(tables.map((row) => row.tablename)).toEqual(
      expect.arrayContaining(['users', 'quotes', 'collections', 'api_tokens']),
    )
  } finally {
    process.argv = original
  }
})

it('seeds usable development accounts once and refuses production or missing configuration', async () => {
  await runMigrations(url)
  vi.stubEnv('DATABASE_URL', '')
  await expect(import('../src/db/seed')).rejects.toThrow('DATABASE_URL is required')
  vi.resetModules()
  vi.stubEnv('DATABASE_URL', url)
  vi.stubEnv('NODE_ENV', 'production')
  await expect(import('../src/db/seed')).rejects.toThrow('Refusing to seed a production database')
  vi.resetModules()
  vi.stubEnv('NODE_ENV', 'test')
  vi.spyOn(console, 'log').mockImplementation(() => {})
  await import('../src/db/seed')
  const accounts = await sql`select id, email, role from users order by email`
  expect(accounts.map((row) => [row.email, row.role])).toEqual([
    ['admin@quotedb.local', 'SUPER_ADMIN'],
    ['izaro@quotedb.local', 'USER'],
  ])
  const originalQuotes = await sql`select id, collection_id from quotes order by id`
  expect(originalQuotes).toHaveLength(4)
  vi.resetModules()
  await import('../src/db/seed')
  expect(await sql`select id, collection_id from quotes order by id`).toEqual(originalQuotes)
  expect(await sql`select id, email, role from users order by email`).toEqual(accounts)
})

it('keeps declared foreign-key targets and deletion rules aligned with the migrated database', async () => {
  await runMigrations(url)
  const actual =
    await sql`select c.relname as source, a.attname as column, f.relname as target, con.confdeltype as deletion
    from pg_constraint con join pg_class c on c.oid = con.conrelid
    join pg_class f on f.oid = con.confrelid
    join pg_attribute a on a.attrelid = c.oid and a.attnum = con.conkey[1]
    where con.contype = 'f' and c.relnamespace = 'public'::regnamespace`
  const policies: Record<string, string> = {
    cascade: 'c',
    restrict: 'r',
    'set null': 'n',
    'no action': 'a',
  }
  const declared = [
    schema.users,
    schema.collections,
    schema.collectionMembers,
    schema.quotes,
    schema.sessions,
    schema.loginChallenges,
    schema.apiTokens,
  ].flatMap((table) => {
    const config = getTableConfig(table)
    return config.foreignKeys.map((key) => {
      const ref = key.reference()
      assert(ref.columns[0])
      const property = ref.columns[0].name
      const column = property.replace(/[A-Z]/g, (char) => `_${char.toLowerCase()}`)
      return {
        source: config.name,
        column,
        target: getTableConfig(ref.foreignTable).name,
        deletion: policies[key.onDelete ?? 'no action'],
      }
    })
  })
  expect(actual).toHaveLength(declared.length)
  expect(actual).toEqual(expect.arrayContaining(declared))
})

it('starts a real HTTP listener and handles repeated shutdown signals only once', async () => {
  await runMigrations(url)
  vi.stubEnv('DATABASE_URL', url)
  vi.stubEnv('NODE_ENV', 'development')
  vi.stubEnv('HOST', '127.0.0.1')
  vi.stubEnv('PORT', '0')
  vi.stubEnv('LOG_LEVEL', 'silent')
  vi.stubEnv('COOKIE_SECRET', 'operations-test-secret-with-at-least-32-characters')
  const server = await import('../src/server')
  const build = server.buildApp
  let app: Awaited<ReturnType<typeof build>> | undefined
  vi.spyOn(server, 'buildApp').mockImplementation(async (options) => {
    app = await build(options)
    return app
  })
  const handlers = new Map<string, () => Promise<void>>()
  const on = process.on.bind(process)
  vi.spyOn(process, 'on').mockImplementation((event, listener) => {
    if (event === 'SIGTERM' || event === 'SIGINT') {
      handlers.set(event, listener as () => Promise<void>)
      return process
    }
    return on(event, listener)
  })
  const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
  try {
    await import('../src/index')
    expect(app?.server.listening).toBe(true)
    assert(app)
    const address = app.server.address()
    if (!address || typeof address === 'string') throw new Error('No HTTP address')
    const response = await fetch(`http://127.0.0.1:${address.port}/healthz`)
    expect(response.status).toBe(200)
    const terminate = handlers.get('SIGTERM')
    const interrupt = handlers.get('SIGINT')
    assert(terminate && interrupt)
    await terminate()
    await interrupt()
    expect(app.server.listening).toBe(false)
    expect(exit).toHaveBeenCalledExactlyOnceWith(0)
  } finally {
    await app?.close()
  }
})
