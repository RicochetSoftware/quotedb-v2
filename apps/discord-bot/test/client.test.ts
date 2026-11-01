import { type Client, Events, GatewayIntentBits } from 'discord.js'
import { afterEach, expect, it, vi } from 'vitest'
import { createClient } from '../src/client.js'

afterEach(() => vi.restoreAllMocks())

it('disables automatic mentions and requests the intents needed to save guild messages', async () => {
  const client = createClient()
  try {
    expect(client.options.allowedMentions).toEqual({ parse: [], repliedUser: false })
    expect(client.options.intents.has(GatewayIntentBits.Guilds)).toBe(true)
    expect(client.options.intents.has(GatewayIntentBits.GuildMessages)).toBe(true)
    expect(client.options.intents.has(GatewayIntentBits.MessageContent)).toBe(true)
    expect(client.options.intents.has(GatewayIntentBits.DirectMessages)).toBe(false)
  } finally {
    await client.destroy()
  }
})

it('logs readiness once and handles errors without leaking their sensitive details', async () => {
  const info = vi.spyOn(console, 'info').mockImplementation(() => {})
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})
  const client = createClient()
  try {
    // Emit the gateway events locally without logging in or connecting to Discord.
    const ready = { user: { tag: 'QuoteDB#1234' } } as unknown as Client<true>
    client.emit(Events.ClientReady, ready)
    client.emit(Events.ClientReady, ready)
    expect(info).toHaveBeenCalledExactlyOnceWith('QuoteDB bot connected as QuoteDB#1234')
    client.emit(Events.Error, new Error('secret-auth-token'))
    expect(error).toHaveBeenCalledExactlyOnceWith('Discord client encountered an error')
  } finally {
    await client.destroy()
  }
})
