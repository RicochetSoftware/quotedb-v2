import type { Env } from './env'
import { probe } from './probes'

export default {
  async scheduled(_controller: ScheduledController, env: Env) {
    const at = Date.now()
    const pair =
      env.PROBE_PAIR === 'frontend' ? (['web', 'site'] as const) : (['api', 'admin'] as const)
    const observations = await Promise.all(pair.map((component) => probe(component, env, at)))
    await env.DB.prepare(`INSERT INTO probe_samples
      SELECT json_extract(value,'$.component'),json_extract(value,'$.at'),value FROM json_each(?) WHERE 1
      ON CONFLICT(component) DO UPDATE SET observed_at=excluded.observed_at,data=excluded.data
      WHERE excluded.observed_at>probe_samples.observed_at`)
      .bind(JSON.stringify(observations))
      .run()
  },
  async fetch() {
    return new Response('Not found', { status: 404 })
  },
} satisfies ExportedHandler<Env>
