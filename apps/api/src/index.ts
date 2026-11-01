import { createDb } from './db/client'
import { loadEnv } from './env'
import { buildApp } from './server'

const env = loadEnv()
const { db, close } = createDb(env.DATABASE_URL)
const app = await buildApp({
  env,
  db,
  logger:
    env.NODE_ENV === 'development'
      ? { level: env.LOG_LEVEL, transport: { target: 'pino-pretty' } }
      : undefined,
})

let shuttingDown = false
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    if (shuttingDown) return
    shuttingDown = true
    app.log.info({ signal }, 'shutting down')
    await app.close()
    await close()
    process.exit(0)
  })
}

await app.listen({ host: env.HOST, port: env.PORT })
