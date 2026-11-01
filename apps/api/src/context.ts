import type { Db } from './db/client'
import type { Env } from './env'
import type { Mailer } from './lib/mailer'

/** Dependencies shared by every route; injected so tests can swap the mailer. */
export interface AppContext {
  env: Env
  db: Db
  mailer: Mailer
}

declare module 'fastify' {
  interface FastifyInstance {
    ctx: AppContext
  }
}
