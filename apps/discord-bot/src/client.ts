import { Client, Events, GatewayIntentBits } from 'discord.js'

export function createClient() {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
    allowedMentions: { parse: [], repliedUser: false },
  })
  client.once(Events.ClientReady, (ready) =>
    console.info(`QuoteDB bot connected as ${ready.user.tag}`),
  )
  client.on(Events.Error, () => console.error('Discord client encountered an error'))
  return client
}
