import type { Env } from './env'
import { publishSnapshot } from './public'
import { prune } from './storage'
import { summarize } from './summary'
export async function maintain(env: Env, now = Date.now()) {
  // Run snapshot work before delivery so a slow external destination cannot delay publication.
  await summarize(env, now)
  await publishSnapshot(env, now)
  await prune(env, now)
}
export default {
  async scheduled(_controller: ScheduledController, env: Env) {
    try {
      await maintain(env)
    } catch {
      console.error('monitoring_maintenance_failed')
    }
  },
  async fetch() {
    return new Response('Not found', { status: 404 })
  },
} satisfies ExportedHandler<Env>
