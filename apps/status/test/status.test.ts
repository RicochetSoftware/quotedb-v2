import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Env } from '../src/env'
import { botObservation, ingest, operate } from '../src/ingestion'
import {
  availability,
  currentStatus,
  DAY,
  interval,
  type Observation,
  reduce,
  type State,
} from '../src/model'
import { probe } from '../src/probes'
import { status } from '../src/public'
import { commit, loadStates } from '../src/storage'
import { summarize } from '../src/summary'
import { database } from './database'

const observation = (outcome: Observation['outcome'], at: number): Observation => ({
  component: 'api',
  at,
  duration: 10,
  outcome,
  reason: null,
})
const env = () =>
  ({ DB: database(), BOT_SECRET: 'a'.repeat(32), OPERATOR_SECRET: 'b'.repeat(32) }) as Env
const evolve = (outcomes: Observation['outcome'][]) =>
  outcomes.reduce<State | undefined>(
    (state, outcome, index) => reduce(state, observation(outcome, index * 60000)),
    undefined,
  ) as State

afterEach(() => vi.restoreAllMocks())
describe('state and measurement semantics', () => {
  it('debounces failure, requires three recovery observations and permits slow recovery', () => {
    expect(evolve(['failed']).status).toBe('unknown')
    expect(evolve(['failed', 'failed']).status).toBe('down')
    expect(evolve(['failed', 'failed', 'healthy', 'healthy']).status).toBe('down')
    expect(evolve(['failed', 'failed', 'healthy', 'healthy', 'healthy']).status).toBe('operational')
    expect(evolve(['failed', 'failed', 'slow', 'slow', 'slow']).status).toBe('degraded')
  })
  it('counts three slow successes in five and rejects late evaluations', () => {
    const state = evolve(['slow', 'healthy', 'slow', 'healthy', 'slow'])
    expect(state.status).toBe('degraded')
    expect(reduce(state, observation('healthy', 0))).toBe(state)
    expect(currentStatus(state, state.at + 180001)).toBe('unknown')
    expect(reduce(state, observation('healthy', state.at + 240000)).status).toBe('unknown')
  })
  it('caps observed intervals and splits midnight without double-counting', () => {
    const parts = interval(observation('slow', DAY - 30000), DAY + 300000)
    expect(parts.map((p) => p.totals.available)).toEqual([30, 150])
    expect(parts.map((p) => p.totals.degraded)).toEqual([30, 150])
    const result = availability(
      { available: 60, unavailable: 60, degraded: 10, maintenance: 60 },
      240,
    )
    expect(result).toMatchObject({ percent: 50, unknown: 60, coverage: 0.5 })
    expect(
      availability({ available: 0, unavailable: 0, degraded: 0, maintenance: 0 }, 60).percent,
    ).toBeNull()
  })
})
describe('D1 transactional lifecycle', () => {
  it('deduplicates retries, rejects stale reads and preserves unresolved incidents through gaps', async () => {
    const e = env()
    const first = [observation('failed', 60000)]
    await commit(e, 1, first, [])
    await commit(e, 1, first, [])
    expect((await e.DB.prepare('SELECT * FROM check_samples').all()).results).toHaveLength(1)
    await commit(e, 2, [observation('failed', 120000)], await loadStates(e))
    expect((await e.DB.prepare('SELECT * FROM incidents').all()).results).toHaveLength(1)
    expect((await commit(e, 3, [observation('healthy', 180000)], [])).committed).toBe(false)
    await commit(e, 6, [observation('unknown', 360000)], await loadStates(e))
    expect(await e.DB.prepare('SELECT resolved_at FROM incidents').first()).toEqual({
      resolved_at: null,
    })
    for (let bucket = 7; bucket <= 9; bucket++)
      await commit(e, bucket, [observation('healthy', bucket * 60000)], await loadStates(e))
    expect(await e.DB.prepare('SELECT resolved_at FROM incidents').first()).toEqual({
      resolved_at: 540000,
    })
    const view = await status(e, 900000)
    expect(view.stale).toBe(true)
    expect(JSON.stringify(view)).not.toContain('duration')
    expect(view.components).toHaveLength(5)
  })
  it('keeps brief failures in measured uptime even before an incident is confirmed', async () => {
    const e = env()
    for (const [i, outcome] of (
      ['healthy', 'failed', 'healthy', 'healthy', 'healthy'] as const
    ).entries())
      await commit(e, i + 1, [observation(outcome, (i + 1) * 60000)], await loadStates(e))
    await summarize(e, 1200000)
    const summary = await e.DB.prepare('SELECT data FROM summary').first<{ data: string }>()
    const history = JSON.parse(summary?.data ?? '{}').api
    expect(history.windows[0].unavailable).toBe(60)
    expect(history.windows[0].unknown).toBeGreaterThan(0)
  })
})
describe('heartbeat security', () => {
  it('requires credentials, rejects malformed payloads, replay and retired boots', async () => {
    const e = env()
    const h = {
      id: crypto.randomUUID(),
      boot: crypto.randomUUID(),
      sequence: 1,
      ready: true,
      db: true,
      api: true,
      discord: true,
      latency: 10,
    }
    const send = (body: unknown, auth = `Bearer ${e.BOT_SECRET}`) =>
      ingest(
        new Request('https://status/heartbeat', {
          method: 'POST',
          headers: { authorization: auth },
          body: JSON.stringify(body),
        }),
        e,
      )
    expect((await send(h, '')).status).toBe(401)
    expect((await send({ ...h, sequence: -1 })).status).toBe(400)
    expect((await send({ ...h, ready: false })).status).toBe(400)
    expect((await send(h)).status).toBe(204)
    expect((await send(h)).status).toBe(409)
    expect((await send({ ...h, boot: crypto.randomUUID() })).status).toBe(204)
    expect((await send({ ...h, sequence: 2 })).status).toBe(409)
  })
  it('never treats absent gateway latency as zero', () => {
    expect(
      botObservation(
        { received_at: 1, data: JSON.stringify({ ready: true, latency: null }) },
        2,
        500,
      ).outcome,
    ).toBe('unknown')
    expect(botObservation({ received_at: 1, data: '{}' }, 180002, 500).reason).toBe(
      'heartbeat_stale',
    )
  })
  it('protects operator changes and bounds maintenance', async () => {
    const e = env()
    const request = (body: object, auth = '') =>
      new Request('https://status/operator', {
        method: 'POST',
        headers: { authorization: auth },
        body: JSON.stringify(body),
      })
    expect((await operate(request({}), e)).status).toBe(401)
    expect(
      (
        await operate(
          request(
            {
              id: 'window',
              kind: 'maintenance',
              component: 'web',
              start: Date.now(),
              end: Date.now() + 60000,
              note: 'Deployment',
            },
            `Bearer ${e.OPERATOR_SECRET}`,
          ),
          e,
        )
      ).status,
    ).toBe(204)
  })
})
describe('public URL probes', () => {
  it('rejects login redirects and content mismatches without exposing response bodies', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('secret', { status: 302 })))
    expect(await probe('site', { ...env(), SITE_URL: 'https://example.com' }, 1)).toMatchObject({
      outcome: 'failed',
      reason: 'http_status',
    })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('secret')))
    expect(await probe('site', { ...env(), SITE_URL: 'https://example.com' }, 1)).toMatchObject({
      outcome: 'failed',
      reason: 'content',
    })
    vi.unstubAllGlobals()
  })
})

describe('public failure and outbox behavior', () => {
  it('marks cached snapshots unknown after monitoring stops and fails closed on quota errors', async () => {
    const { publishSnapshot, readSnapshot, default: publicWorker } = await import('../src/public')
    const e = env()
    for (let i = 1; i <= 3; i++)
      await commit(e, i, [observation('healthy', i * 60000)], await loadStates(e))
    await publishSnapshot(e, 180000)
    expect(
      (await readSnapshot(e, 180001)).components.find((c) => c.component === 'api')?.status,
    ).toBe('operational')
    expect(
      (await readSnapshot(e, 360001)).components.find((c) => c.component === 'api')?.status,
    ).toBe('unknown')
    const broken = {
      ...e,
      DB: {
        prepare() {
          throw new Error('quota exhausted: private detail')
        },
      },
    } as unknown as Env
    const response = await publicWorker.fetch(new Request('https://status/api/status'), broken)
    expect(response.status).toBe(503)
    expect(await response.text()).not.toContain('private detail')
  })
  it('retries failed exports without duplicating delivered work', async () => {
    const { deliver } = await import('../src/delivery')
    const e = { ...env(), OTLP_URL: 'https://metrics.test/v1/metrics', OTLP_AUTH: 'Basic test' }
    await e.DB.prepare(
      "INSERT INTO notification_outbox(id,kind,payload,next_retry) VALUES('sample','metrics','[]',0)",
    ).run()
    const send = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue(new Response('{}'))
    vi.stubGlobal('fetch', send)
    await deliver(e, 1)
    await deliver(e, 2)
    expect(send).toHaveBeenCalledTimes(1)
    await deliver(e, 60002)
    await deliver(e, 60003)
    expect(send).toHaveBeenCalledTimes(2)
    vi.unstubAllGlobals()
  })
})

it('does not reuse distributed probes and makes stopped probe workers unknown', async () => {
  const { evaluate } = await import('../src/monitor')
  const e = env()
  e.DISTRIBUTED_PROBES = 'true'
  const base = 180000
  for (const component of ['web', 'admin', 'api', 'site']) {
    const sample = { component, at: base, duration: 10, outcome: 'healthy', reason: null }
    await e.DB.prepare('INSERT INTO probe_samples VALUES(?,?,?)')
      .bind(component, base, JSON.stringify(sample))
      .run()
  }
  await evaluate(e, base)
  expect((await loadStates(e)).find((s) => s.component === 'api')?.healthy).toBe(1)
  await evaluate(e, base + 60000)
  expect((await loadStates(e)).find((s) => s.component === 'api')?.healthy).toBe(1)
  await evaluate(e, base + 120000)
  expect((await loadStates(e)).find((s) => s.component === 'api')?.status).toBe('unknown')
  expect((await status(e, base + 120000)).stale).toBe(true)
})

it('exports current gauges before a stale metrics backlog', async () => {
  const { deliver } = await import('../src/delivery')
  const e = { ...env(), OTLP_URL: 'https://metrics.test/v1/metrics', OTLP_AUTH: 'Basic test' }
  for (const id of ['metrics-100', 'metrics-101', 'metrics-102'])
    await e.DB.prepare(
      "INSERT INTO notification_outbox(id,kind,payload,next_retry) VALUES(?,'metrics','[]',0)",
    )
      .bind(id)
      .run()
  const send = vi.fn().mockImplementation(() => Promise.resolve(new Response('{}')))
  vi.stubGlobal('fetch', send)
  await deliver(e, 1)
  expect(send.mock.calls.map((call) => call[1].headers['Idempotency-Key'])).toEqual([
    'metrics-102',
    'metrics-101',
  ])
  vi.unstubAllGlobals()
})

it('serves a small cross-origin notice without history or incident notes', async () => {
  const { default: worker } = await import('../src/public')
  const testEnv = env()
  await testEnv.DB.prepare('INSERT INTO public_snapshot VALUES(1,?)')
    .bind(
      JSON.stringify({
        stale: false,
        components: [
          { component: 'api', status: 'down', lastCheck: Date.now(), history: { large: true } },
        ],
        notes: [{ note: 'Incident detail' }],
      }),
    )
    .run()
  const response = await worker.fetch(new Request('https://status.example/api/notice'), testEnv)
  expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*')
  expect(await response.json()).toEqual({
    components: [{ component: 'api', status: 'down', lastCheck: expect.any(Number) }],
  })
})
