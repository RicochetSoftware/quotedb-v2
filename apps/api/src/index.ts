import { createDb } from './db/client'
import { loadEnv } from './env'
import { startMetrics } from './metrics'
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

const metrics = process.env.METRICS_ENABLED === 'true' ? startMetrics(app.metrics) : undefined
let shuttingDown = false
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    if (shuttingDown) return
    shuttingDown = true
    app.log.info({ signal }, 'shutting down')
    metrics?.close()
    await app.close()
    await close()
    process.exit(0)
  })
}

await app.listen({ host: env.HOST, port: env.PORT })
