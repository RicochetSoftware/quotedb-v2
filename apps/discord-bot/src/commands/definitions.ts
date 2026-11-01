import {
  ApplicationCommandType,
  ContextMenuCommandBuilder,
  InteractionContextType,
  SlashCommandBuilder,
} from 'discord.js'

export const commands = [
  new SlashCommandBuilder()
    .setName('quote')
    .setDescription('Quotes from this server’s QuoteDB collection')
    .setContexts(InteractionContextType.Guild)
    .addSubcommand((c) =>
      c
        .setName('random')
        .setDescription('Show random quotes')
        .addIntegerOption((o) =>
          o
            .setName('count')
            .setDescription('Number of quotes (default 5)')
            .setMinValue(1)
            .setMaxValue(20),
        ),
    )
    .addSubcommand((c) => c.setName('list').setDescription('Browse recent quotes'))
    .addSubcommand((c) =>
      c
        .setName('search')
        .setDescription('Search quotes')
        .addStringOption((o) =>
          o.setName('text').setDescription('Search text').setRequired(true).setMaxLength(200),
        )
        .addStringOption((o) =>
          o
            .setName('author')
            .setDescription('Exact author name (case-insensitive)')
            .setMaxLength(255),
        ),
    )
    .addSubcommand((c) => c.setName('create').setDescription('Write a new quote'))
    .addSubcommand((c) =>
      c.setName('setup').setDescription('Administrators: connect a collection integration key'),
    )
    .addSubcommand((c) =>
      c.setName('settings').setDescription('Administrators: configure roles and channels'),
    ),
  new SlashCommandBuilder()
    .setName('izaro')
    .setDescription('Show one random Izaro quote')
    .setContexts(InteractionContextType.Guild),
  new ContextMenuCommandBuilder()
    .setName('Save quote')
    .setType(ApplicationCommandType.Message)
    .setContexts(InteractionContextType.Guild),
].map((c) => c.toJSON())
