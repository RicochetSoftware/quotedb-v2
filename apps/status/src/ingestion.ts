import type { Env } from './env'
import { maintain } from './maintenance'
import { components, type Observation } from './model'
import { boundedText } from './probes'

export interface Heartbeat {
  id: string
  boot: string
  sequence: number
  ready: boolean
  db: boolean
  api: boolean
  discord: boolean
  latency: number | null
}
export function validHeartbeat(value: unknown): value is Heartbeat {
  if (!value || typeof value !== 'object') return false
  const h = value as Heartbeat
  return (
    /^[a-f0-9-]{36}$/.test(h.id) &&
    /^[a-f0-9-]{36}$/.test(h.boot) &&
    Number.isSafeInteger(h.sequence) &&
    h.sequence >= 0 &&
    ['ready', 'db', 'api', 'discord'].every(
      (key) => typeof (value as Record<string, unknown>)[key] === 'boolean',
    ) &&
    h.ready === (h.db && h.api && h.discord) &&
    (h.latency === null ||
      (typeof h.latency === 'number' &&
        Number.isFinite(h.latency) &&
        h.latency >= 0 &&
        h.latency < 3_600_000))
  )
}
export async function authorized(request: Request, ...secrets: (string | undefined)[]) {
  const header = request.headers.get('authorization')
  if (!header?.startsWith('Bearer ')) return false
  const token = header.slice(7)
  if (!token || token.length > 256) return false
  const digest = async (s: string) =>
    new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))
  const actual = await digest(token)
  for (const secret of secrets) {
    if (!secret || secret.length < 32) continue
    const expected = await digest(secret)
    let difference = 0
    for (let i = 0; i < actual.length; i++) difference |= (actual[i] ?? 0) ^ (expected[i] ?? 0)
    if (difference === 0) return true
  }
  return false
}
export async function ingest(request: Request, env: Env) {
  if (!(await authorized(request, env.BOT_SECRET, env.BOT_SECRET_PREVIOUS)))
    return new Response('Unauthorized', { status: 401 })
  let h: Heartbeat
  try {
    const body = JSON.parse(await boundedText(new Response(request.body), 2048))
    if (!validHeartbeat(body)) throw new Error('invalid')
    h = {
      id: body.id,
      boot: body.boot,
      sequence: body.sequence,
      ready: body.ready,
      db: body.db,
      api: body.api,
      discord: body.discord,
      latency: body.latency,
    }
  } catch {
    return new Response('Invalid heartbeat', { status: 400 })
  }
  const now = Date.now()
  const result = await env.DB.batch([
    env.DB.prepare(`INSERT INTO bot_heartbeats VALUES(1,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET boot=excluded.boot,sequence=excluded.sequence,
      heartbeat_id=excluded.heartbeat_id,received_at=excluded.received_at,data=excluded.data
      WHERE (boot=excluded.boot AND sequence<excluded.sequence AND heartbeat_id<>excluded.heartbeat_id)
      OR (boot<>excluded.boot AND NOT EXISTS(SELECT 1 FROM bot_boots WHERE boot=excluded.boot))`).bind(
      h.boot,
      h.sequence,
      h.id,
      now,
      JSON.stringify(h),
    ),
    env.DB.prepare('INSERT OR IGNORE INTO bot_boots VALUES(?,?)').bind(h.boot, now),
  ])
  return new Response(null, { status: result[0]?.meta.changes ? 204 : 409 })
}
export function botObservation(
  row: { received_at: number; data: string } | null,
  now: number,
  threshold: number,
): Observation {
  const base = {
    component: 'bot' as const,
    at: now,
    duration: null,
    reason: null,
    heartbeatAge: row ? Math.max(0, (now - row.received_at) / 1000) : null,
  }
  if (!row || now - row.received_at > 180000)
    return { ...base, outcome: 'failed', reason: 'heartbeat_stale' }
  const h = JSON.parse(row.data) as Heartbeat
  if (!h.ready)
    return {
      ...base,
      outcome: 'failed',
      reason: !h.api ? 'api_dependency' : !h.db ? 'database_dependency' : 'discord_unavailable',
    }
  if (h.latency === null) return { ...base, outcome: 'unknown', reason: 'latency_missing' }
  return { ...base, duration: h.latency, outcome: h.latency > threshold ? 'slow' : 'healthy' }
}
export async function operate(request: Request, env: Env) {
  if (!(await authorized(request, env.OPERATOR_SECRET)))
    return new Response('Unauthorized', { status: 401 })
  try {
    const body = JSON.parse(await boundedText(new Response(request.body), 4096))
    if (body.kind === 'refresh') {
      await maintain(env)
      return new Response(null, { status: 204 })
    }
    if (
      typeof body.id !== 'string' ||
      !/^[a-zA-Z0-9-]{1,80}$/.test(body.id) ||
      typeof body.note !== 'string' ||
      body.note.length > 500
    )
      throw new Error('invalid')
    if (body.kind === 'maintenance') {
      if (
        !components.includes(body.component) ||
        !Number.isSafeInteger(body.start) ||
        !Number.isSafeInteger(body.end) ||
        body.start < Date.now() - 60000 ||
        body.end <= body.start ||
        body.end - body.start > 7 * 86400000
      )
        throw new Error('invalid')
      await env.DB.prepare('INSERT OR IGNORE INTO maintenance_windows VALUES(?,?,?,?,?)')
        .bind(body.id, body.component, body.start, body.end, body.note)
        .run()
    } else if (body.kind === 'note' && typeof body.incident === 'string') {
      await env.DB.prepare("INSERT OR IGNORE INTO incident_events VALUES(?,?,?,'note',?)")
        .bind(body.id, body.incident, Date.now(), body.note)
        .run()
    } else throw new Error('invalid')
    return new Response(null, { status: 204 })
  } catch {
    return new Response('Invalid operation', { status: 400 })
  }
}
