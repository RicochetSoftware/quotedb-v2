import type { Env } from './env'
import { components, currentStatus, type State } from './model'
export async function status(env: Env, now: number) {
  const results = await env.DB.batch([
    env.DB.prepare('SELECT data FROM component_state'),
    env.DB.prepare('SELECT started_at,updated_at,data FROM summary WHERE id=1'),
    env.DB.prepare(
      'SELECT id,component,first_failure_at,confirmed_at,severity,resolved_at FROM incidents WHERE resolved_at IS NULL OR resolved_at>? ORDER BY confirmed_at DESC LIMIT 30',
    ).bind(now - 30 * 86400000),
    env.DB.prepare(
      'SELECT component,starts_at,ends_at,note FROM maintenance_windows WHERE ends_at>? ORDER BY starts_at LIMIT 25',
    ).bind(now),
    env.DB.prepare(
      "SELECT incident_id,at,note FROM incident_events WHERE kind='note' ORDER BY at DESC LIMIT 20",
    ),
  ])
  const states = ((results[0]?.results ?? []) as { data: string }[]).map(
    (row) => JSON.parse(row.data) as State,
  )
  const summary = results[1]?.results[0] as
    | { started_at: number; updated_at: number; data: string }
    | undefined
  const history = JSON.parse(summary?.data ?? '{}')
  const stale =
    states.length !== 5 ||
    states.some((state) => now - state.at > 180000 || state.observation.reason === 'probe_stale')
  return {
    generatedAt: now,
    stale,
    measurementStart: summary?.started_at ?? null,
    historyAt: summary?.updated_at ?? null,
    components: components.map((component) => {
      const state = states.find((s) => s.component === component)
      return {
        component,
        status: state ? currentStatus(state, now) : 'unknown',
        lastCheck: state?.at ?? null,
        dependency: state?.observation.reason === 'api_dependency' ? 'api' : null,
        history: history[component] ?? null,
      }
    }),
    incidents: results[2]?.results,
    maintenance: results[3]?.results,
    notes: results[4]?.results,
  }
}
export async function publishSnapshot(env: Env, now: number) {
  const data = await status(env, now)
  await env.DB.prepare(
    'INSERT INTO public_snapshot VALUES(1,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data',
  )
    .bind(JSON.stringify(data))
    .run()
}
export async function readSnapshot(env: Env, now: number) {
  const row = await env.DB.prepare('SELECT data FROM public_snapshot WHERE id=1').first<{
    data: string
  }>()
  if (!row)
    return {
      generatedAt: now,
      stale: true,
      measurementStart: null,
      historyAt: null,
      components: components.map((component) => ({
        component,
        status: 'unknown',
        lastCheck: null,
        history: null,
      })),
      incidents: [],
      maintenance: [],
      notes: [],
    }
  const data = JSON.parse(row.data) as Awaited<ReturnType<typeof status>>
  data.generatedAt = now
  data.stale =
    data.stale ||
    data.components.some((component) => !component.lastCheck || now - component.lastCheck > 180000)
  for (const component of data.components)
    if (!component.lastCheck || now - component.lastCheck > 180000) component.status = 'unknown'
  return data
}
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const path = new URL(request.url).pathname
    if (request.method === 'POST' && (path === '/heartbeat' || path === '/operator'))
      return env.MONITOR.fetch(request)
    if (request.method !== 'GET' && request.method !== 'HEAD')
      return new Response('Method not allowed', { status: 405 })
    if (path !== '/api/status' && path !== '/api/notice') return env.ASSETS.fetch(request)
    try {
      const snapshot = await readSnapshot(env, Date.now())
      const data =
        path === '/api/notice'
          ? {
              components: snapshot.components.map(({ component, status, lastCheck }) => ({
                component,
                status,
                lastCheck,
              })),
            }
          : snapshot
      return Response.json(data, {
        headers: {
          'Cache-Control': 'public, max-age=10',
          'X-Content-Type-Options': 'nosniff',
          'Access-Control-Allow-Origin': '*',
        },
      })
    } catch {
      return Response.json(
        { stale: true, error: 'Monitoring unavailable' },
        {
          status: 503,
          headers: { 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' },
        },
      )
    }
  },
} satisfies ExportedHandler<Env>
