import type { Env } from './env'
import { botObservation, ingest, operate } from './ingestion'
import type { Observation, State } from './model'
import { probe } from './probes'
import { commit } from './storage'

export async function evaluate(env: Env, now = Date.now()) {
  const bucket = Math.floor(now / 60000)
  const [stateRows, heartbeatRows, maintenance] = await env.DB.batch([
    env.DB.prepare('SELECT data FROM component_state'),
    env.DB.prepare('SELECT received_at,data FROM bot_heartbeats WHERE id=1'),
    env.DB.prepare(
      'SELECT component FROM maintenance_windows WHERE starts_at<=? AND ends_at>?',
    ).bind(now, now),
  ])
  const previous = ((stateRows?.results ?? []) as { data: string }[]).map(
    (row) => JSON.parse(row.data) as State,
  )
  const heartbeat =
    (heartbeatRows?.results[0] as { received_at: number; data: string } | undefined) ?? null
  if (previous.some((state) => state.at >= bucket * 60000)) return
  let observations: Observation[]
  if (env.DISTRIBUTED_PROBES === 'true') {
    const rows = await env.DB.prepare('SELECT data FROM probe_samples').all<{ data: string }>()
    const samples = rows.results.map((row) => JSON.parse(row.data) as Observation)
    const targets = ['web', 'admin', 'api', 'site'] as const
    // Do not count a probe twice toward incident confirmation or recovery.
    if (
      targets.some((component) => {
        const sample = samples.find((row) => row.component === component)
        const old = previous.find((row) => row.component === component)
        return sample && now - sample.at <= 90000 && sample.at === old?.observation.sourceAt
      })
    )
      return
    observations = targets.map((component) => {
      const sample = samples.find((row) => row.component === component)
      if (!sample || now - sample.at > 90000)
        return { component, at: now, duration: null, outcome: 'unknown', reason: 'probe_stale' }
      return { ...sample, at: now, sourceAt: sample.at }
    })
  } else {
    observations = await Promise.all(
      (['web', 'admin', 'api', 'site'] as const).map((component) => probe(component, env, now)),
    )
  }
  observations.push(botObservation(heartbeat, now, Number(env.BOT_LATENCY_MS || 500)))
  const api = observations.find((o) => o.component === 'api')
  for (const observation of observations) {
    if (api?.outcome === 'failed' && ['web', 'admin', 'bot'].includes(observation.component)) {
      observation.outcome = 'failed'
      observation.reason = 'api_dependency'
    }
    if (
      ((maintenance?.results ?? []) as { component: string }[]).some(
        (row) => row.component === observation.component,
      )
    ) {
      observation.outcome = 'maintenance'
      observation.reason = null
    }
  }
  await commit(env, bucket, observations, previous)
}
export default {
  async scheduled(_controller: ScheduledController, env: Env) {
    try {
      await evaluate(env)
    } catch {
      console.error('monitoring_evaluation_failed')
    }
  },
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== 'POST') return new Response('Not found', { status: 404 })
    try {
      const path = new URL(request.url).pathname
      if (path === '/heartbeat') return await ingest(request, env)
      if (path === '/operator') return await operate(request, env)
      return new Response('Not found', { status: 404 })
    } catch {
      return new Response('Monitoring unavailable', { status: 503 })
    }
  },
} satisfies ExportedHandler<Env>
