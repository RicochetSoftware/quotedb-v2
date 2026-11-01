import { createServer } from 'node:http'
import { Events } from 'discord.js'
import { createBot } from './bot.js'
import { createClient } from './client.js'
import { createStore } from './db/store.js'
import { readEnv } from './env.js'

const env = readEnv()
const store = createStore(env.databaseUrl)
const client = createClient()
const bot = createBot(client, env, store)
client.on(Events.InteractionCreate, (interaction) => void bot.interaction(interaction))
client.on(Events.MessageCreate, (message) => void bot.message(message))
const health = createServer(async (_req, res) => {
  try {
    await store.health()
    const response = await fetch(`${env.apiUrl}/healthz`, { signal: AbortSignal.timeout(3000) })
    res.statusCode = client.isReady() && response.ok ? 200 : 503
  } catch {
    res.statusCode = 503
  }
  res.end(res.statusCode === 200 ? 'ready' : 'unavailable')
})
let stopping = false
async function shutdown() {
  if (stopping) return
  stopping = true
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
  const settings = await store.get(env.guildId)
  if (settings.credential) {
    const { decrypt } = await import('./security/credentials.js')
    decrypt(env.key, env.guildId, settings.credential)
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
