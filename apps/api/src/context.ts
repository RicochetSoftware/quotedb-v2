import type { Db } from './db/client'
import type { Env } from './env'
import type { Mailer } from './lib/mailer'
import type { BreachChecker } from './lib/passwords'

/** Dependencies shared by every route; injected so tests can swap the mailer and HIBP check. */
export interface AppContext {
  env: Env
  db: Db
  mailer: Mailer
  isBreached: BreachChecker
}

declare module 'fastify' {
  interface FastifyInstance {
    ctx: AppContext
  }
}
