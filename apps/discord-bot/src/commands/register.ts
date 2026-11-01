import { REST, Routes } from 'discord.js'
import { required } from '../env.js'
import { commands } from './definitions.js'

await new REST()
  .setToken(required('DISCORD_BOT_TOKEN'))
  .put(
    Routes.applicationGuildCommands(
      required('DISCORD_APPLICATION_ID'),
      required('DISCORD_GUILD_ID'),
    ),
    { body: commands },
  )
console.info('Registered QuoteDB guild commands')
