import { deliver } from './delivery'
import type { Env } from './env'
export default {
  async scheduled(_controller: ScheduledController, env: Env) {
    await deliver(env, Date.now())
  },
  async fetch() {
    return new Response('Not found', { status: 404 })
  },
} satisfies ExportedHandler<Env>
