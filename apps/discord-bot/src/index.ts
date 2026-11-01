import { createServer } from 'node:http'
import { Events } from 'discord.js'
import { createBot } from './bot.js'
import { createClient } from './client.js'
import { createStore } from './db/store.js'
import { readEnv } from './env.js'
import { gateway, readiness, reconnects, startMetrics } from './metrics.js'
import { readinessChecker, startHeartbeat } from './readiness.js'

const env = readEnv()
const store = createStore(env.databaseUrl)
const client = createClient()
const bot = createBot(client, env, store)
client.on(Events.InteractionCreate, (interaction) => void bot.interaction(interaction))
client.on(Events.MessageCreate, (message) => void bot.message(message))
const checkReadiness = readinessChecker({
  database: () => store.health(),
  apiUrl: env.apiUrl,
  discord: () => client.isReady(),
  latency: () => client.ws.ping,
})
const health = createServer(async (_req, res) => {
  const result = await checkReadiness()
  res.statusCode = result.ready ? 200 : 503
  res.end(result.ready ? 'ready' : 'unavailable')
})
client.on(Events.ShardReconnecting, () => reconnects.inc())
const metrics = process.env.METRICS_ENABLED === 'true' ? startMetrics() : undefined
const stopHeartbeat = startHeartbeat(checkReadiness, (result) => {
  readiness.set(Number(result.ready))
  gateway.set(result.latency === null ? Number.NaN : result.latency / 1000)
})
let stopping = false
async function shutdown() {
  if (stopping) return
  stopping = true
  stopHeartbeat()
  metrics?.close()
  bot.stop()
  health.close()
  await client.destroy()
  await store.close()
}
process.once('SIGINT', () => void shutdown())
process.once('SIGTERM', () => void shutdown())
try {
  await store.health()
  // Fail before connecting if persisted credentials cannot be decrypted after a key change.
  const { decrypt } = await import('./security/credentials.js')
  for (const guildId of env.guildIds) {
    const settings = await store.get(guildId)
    if (settings.credential) decrypt(env.key, guildId, settings.credential)
  }
  health.listen(8090, '127.0.0.1')
  await client.login(env.token)
} catch {
  console.error(
    'Bot startup failed. Check database migrations, encryption key, Discord token and intents.',
  )
  await shutdown()
  process.exitCode = 1
}
