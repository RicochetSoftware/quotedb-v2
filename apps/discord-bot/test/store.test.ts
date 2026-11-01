import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import postgres from 'postgres'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { migrate } from '../src/db/migrations.js'
import { createStore, type Store } from '../src/db/store.js'

let container: StartedPostgreSqlContainer
let store: Store
beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:17').start()
  const sql = postgres(container.getConnectionUri(), { onnotice: () => {} })
  await migrate(sql)
  await migrate(sql)
  await sql.end()
  store = createStore(container.getConnectionUri())
})
afterAll(async () => {
  await store?.close()
  await container?.stop()
})
it('persists settings and uses compare-and-swap for connection updates', async () => {
  expect((await store.get('1')).creator_roles.mode).toBe('all')
  expect(
    await store.connect(
      '1',
      'admin',
      'ciphertext',
      { id: '00000000-0000-4000-8000-000000000001', name: 'Server' },
      'prefix',
      'unconfigured',
    ),
  ).toBe(true)
  expect(
    await store.connect(
      '1',
      'admin',
      'old',
      { id: '00000000-0000-4000-8000-000000000001', name: 'Server' },
      'prefix',
      'unconfigured',
    ),
  ).toBe(false)
  await store.policy('1', 'admin', 'creator_roles', { mode: 'selected', ids: [] })
  await store.close()
  store = createStore(container.getConnectionUri())
  expect((await store.get('1')).credential).toBe('ciphertext')
  expect((await store.get('1')).creator_roles).toEqual({ mode: 'selected', ids: [] })
  const claims = await Promise.all([store.claim('1', 'event'), store.claim('1', 'event')])
  expect(claims.filter(Boolean)).toHaveLength(1)
  await store.disconnect('1', 'admin')
  expect((await store.get('1')).credential).toBeNull()
  expect((await store.get('1')).creator_roles.mode).toBe('selected')
})
