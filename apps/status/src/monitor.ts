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
      `SELECT w.id,w.component,r.requested_at FROM maintenance_windows w
       LEFT JOIN maintenance_recovery r ON r.window_id=w.id WHERE w.starts_at<=? AND w.ends_at>?`,
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
  // Apply dependencies before masking observations with maintenance.
  const apiFailed = observations.some((o) => o.component === 'api' && o.outcome === 'failed')
  for (const observation of observations) {
    if (apiFailed && ['web', 'admin', 'bot'].includes(observation.component)) {
      observation.outcome = 'failed'
      observation.reason = 'api_dependency'
    }
  }
  const windows = (maintenance?.results ?? []) as {
    id: string
    component: string
    requested_at: number | null
  }[]
  const recovered: string[] = []
  for (const observation of observations) {
    const active = windows.filter((row) => row.component === observation.component)
    let covered = false
    for (const window of active) {
      const sourceAt =
        observation.component === 'bot'
          ? (heartbeat?.received_at ?? 0)
          : (observation.sourceAt ?? observation.at)
      if (
        window.requested_at !== null &&
        sourceAt >= window.requested_at &&
        observation.outcome === 'healthy'
      ) {
        recovered.push(window.id)
      } else covered = true
    }
    if (covered) {
      observation.outcome = 'maintenance'
      observation.reason = null
    }
  }
  if (recovered.length)
    await env.DB.prepare(`UPDATE maintenance_windows SET ends_at=MIN(ends_at,?)
      WHERE id IN (SELECT value FROM json_each(?)) AND starts_at<?`)
      .bind(now, JSON.stringify(recovered), now)
      .run()
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
