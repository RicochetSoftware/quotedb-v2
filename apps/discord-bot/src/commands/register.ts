import { REST, Routes } from 'discord.js'
import { readGuildIds, required } from '../env.js'
import { commands } from './definitions.js'

const rest = new REST().setToken(required('DISCORD_BOT_TOKEN'))
for (const guildId of readGuildIds()) {
  await rest.put(Routes.applicationGuildCommands(required('DISCORD_APPLICATION_ID'), guildId), {
    body: commands,
  })
  console.info(`Registered QuoteDB commands in guild ${guildId}`)
}
