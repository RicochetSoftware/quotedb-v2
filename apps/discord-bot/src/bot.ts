import { randomUUID } from 'node:crypto'
import {
  ApiError,
  createApiClient,
  type Quote,
  type QuoteCreateBody,
  type TokenInfo,
} from '@quotedb/shared'
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  type Client,
  type GuildMember,
  type Interaction,
  type Message,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  type RepliableInteraction,
  RoleSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js'
import type { Policy, Settings, Store } from './db/store.js'
import type { Env } from './env.js'
import { channelAllowed, creatorAllowed, UserError } from './policies.js'
import { type DisplayQuote, renderQuotes } from './presentation/quotes.js'
import { decrypt, encrypt } from './security/credentials.js'

interface BaseSession {
  guild: string
  channel: string
  user: string
  expires: number
}
interface PageSession extends BaseSession {
  kind: 'page'
  revision: string
  title: string
  page: number
  busy: boolean
  pages: { quotes: DisplayQuote[]; next?: string }[]
  query?: { q?: string; author?: string }
}
interface ConnectionSession extends BaseSession {
  kind: 'connect'
  credential: string
  info: TokenInfo
  revision: string
}
interface PolicySession extends BaseSession {
  kind: 'policy'
  target: 'creator_roles' | 'channels'
  policy: Policy
}
interface DisconnectSession extends BaseSession {
  kind: 'disconnect'
}
type Session = PageSession | ConnectionSession | PolicySession | DisconnectSession
const ttl = 10 * 60_000
const button = (id: string, label: string, style = ButtonStyle.Secondary) =>
  new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style)
const row = (...buttons: ButtonBuilder[]) =>
  new ActionRowBuilder<ButtonBuilder>().addComponents(buttons)
const field = (id: string, label: string, style: TextInputStyle, max: number, value?: string) => {
  const input = new TextInputBuilder()
    .setCustomId(id)
    .setLabel(label)
    .setStyle(style)
    .setMaxLength(max)
  if (value) input.setValue(value)
  return new ActionRowBuilder<TextInputBuilder>().addComponents(input)
}

export function userMessage(error: unknown) {
  if (error instanceof UserError) return error.message
  if (error instanceof ApiError) {
    if (error.status === 401 || error.status === 403)
      return 'The QuoteDB connection needs attention. Ask an administrator to check its API key and scopes.'
    if (error.status === 429) return 'QuoteDB is busy. Please wait a minute before trying again.'
    if (error.status === 404) return 'No quotes are available for this request.'
    if (error.status === 400)
      return 'QuoteDB could not accept that request. Check the text, author, and date.'
  }
  return 'The request could not be completed. Please try again later.'
}

export function createBot(client: Client, env: Env, store: Store) {
  const sessions = new Map<string, Session>()
  const cooldowns = new Map<string, number>()
  const publicApi = createApiClient({ baseUrl: env.apiUrl, timeoutMs: 8_000 })
  const timer = setInterval(() => {
    const now = Date.now()
    for (const [id, session] of sessions) if (session.expires <= now) sessions.delete(id)
    for (const [id, until] of cooldowns) if (until <= now) cooldowns.delete(id)
  }, 30_000)
  timer.unref()

  const api = (settings: Settings) => {
    if (!settings.credential)
      throw new UserError(
        'This server is not connected to a QuoteDB collection. Ask an administrator to run /quote setup. You can still use /izaro.',
      )
    return createApiClient({
      baseUrl: env.apiUrl,
      bearerToken: decrypt(env.key, settings.guild_id, settings.credential),
      timeoutMs: 8_000,
    })
  }
  const admin = (member: GuildMember) =>
    member.id === member.guild.ownerId || member.permissions.has(PermissionFlagsBits.Administrator)
  const requireAdmin = (member: GuildMember) => {
    if (!admin(member)) throw new UserError('Only Discord administrators can change bot settings.')
  }
  async function context(guildId: string | null, userId: string) {
    if (guildId !== env.guildId)
      throw new UserError('This bot is only available in its configured server.')
    const guild = await client.guilds.fetch(guildId)
    // Fetch current membership rather than trusting a stale modal or component payload.
    const member = await guild.members.fetch({ user: userId, force: true })
    return { guild, member, settings: await store.get(guildId) }
  }
  async function allowed(
    settings: Settings,
    channelId: string,
    member: GuildMember,
    create = false,
  ) {
    const channel = await member.guild.channels.fetch(channelId)
    if (!channel || !channelAllowed(settings.channels, channelId, channel.parentId))
      throw new UserError('Quote commands are not enabled in this channel.')
    if (!channel.permissionsFor(member)?.has(PermissionFlagsBits.ViewChannel))
      throw new UserError('You cannot access this channel.')
    if (
      create &&
      !creatorAllowed(settings.creator_roles, [...member.roles.cache.keys()], admin(member))
    )
      throw new UserError('Your roles do not allow creating quotes in this server.')
    const me = member.guild.members.me ?? (await member.guild.members.fetchMe())
    const required = [
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.EmbedLinks,
      PermissionFlagsBits.AttachFiles,
      channel.isThread()
        ? PermissionFlagsBits.SendMessagesInThreads
        : PermissionFlagsBits.SendMessages,
    ]
    if (!channel.permissionsFor(me)?.has(required))
      throw new UserError(
        'The bot needs permission to view this channel, send messages, embed links, and attach files.',
      )
  }
  function throttle(guild: string, user: string) {
    const now = Date.now()
    const key = `${guild}:${user}`
    if ((cooldowns.get(key) ?? 0) > now || (cooldowns.get(guild) ?? 0) > now)
      throw new UserError('Please wait a moment before running another quote command.')
    cooldowns.set(key, now + 3_000)
    cooldowns.set(guild, now + 750)
  }
  function remember(
    interaction: RepliableInteraction,
    data:
      | Omit<ConnectionSession, keyof BaseSession>
      | Omit<PolicySession, keyof BaseSession>
      | Omit<DisconnectSession, keyof BaseSession>
      | Omit<PageSession, keyof BaseSession>,
  ) {
    if (sessions.size >= 1000) throw new UserError('The bot is busy. Try again shortly.')
    const id = randomUUID()
    sessions.set(id, {
      ...data,
      guild: interaction.guildId ?? '',
      channel: interaction.channelId ?? '',
      user: interaction.user.id,
      expires: Date.now() + ttl,
    } as Session)
    return id
  }
  function getSession(interaction: RepliableInteraction, id: string | undefined) {
    const session = id ? sessions.get(id) : undefined
    if (!session || session.expires < Date.now())
      throw new UserError('This control has expired. Run the command again.')
    if (
      session.guild !== interaction.guildId ||
      session.channel !== interaction.channelId ||
      session.user !== interaction.user.id
    )
      throw new UserError('These controls belong to the person who ran the command.')
    return session
  }
  function pageButtons(id: string, session: PageSession) {
    const current = session.pages[session.page]
    return [
      row(
        button(`page:${id}:prev`, 'Previous').setDisabled(session.page === 0),
        button(`page:${id}:next`, 'Next').setDisabled(
          !current?.next && session.page === session.pages.length - 1,
        ),
      ),
    ]
  }
  function display(quotes: DisplayQuote[], title: string, page?: number) {
    return renderQuotes(quotes, title, env.publicUrl, client.user?.username ?? 'QuoteDB', page)
  }
  async function showPages(
    interaction: RepliableInteraction,
    settings: Settings,
    title: string,
    quotes: DisplayQuote[],
    next?: string,
    query?: PageSession['query'],
    all?: Quote[],
  ) {
    const pages = all
      ? Array.from({ length: Math.max(1, Math.ceil(all.length / 5)) }, (_, n) => ({
          quotes: all.slice(n * 5, n * 5 + 5),
        }))
      : [{ quotes, next }]
    const id = remember(interaction, {
      kind: 'page',
      revision: settings.revision,
      title,
      page: 0,
      busy: false,
      pages,
      ...(query ? { query } : {}),
    })
    const session = sessions.get(id) as PageSession
    await interaction.editReply({
      ...display(pages[0]?.quotes ?? [], title, 1),
      components: pageButtons(id, session),
    })
  }
  async function save(settings: Settings, invocationId: string, body: QuoteCreateBody) {
    const connection = api(settings)
    if (!body.quote.trim() || !body.author.trim())
      throw new UserError('Quote text and author must not be empty.')
    if (body.quote.length > 5000 || body.author.length > 255)
      throw new UserError('Quotes may contain up to 5,000 characters and authors up to 255.')
    if (!(await store.claim(settings.guild_id, invocationId)))
      throw new UserError(
        'This request has already been handled or is still processing. Check /quote list before trying again.',
      )
    let quote: Quote
    try {
      quote = await connection.quotes.create(body)
    } catch (error) {
      if (error instanceof ApiError && error.status < 500) throw error
      throw new UserError(
        'The save could not be confirmed. It may have succeeded; check /quote list before submitting again.',
      )
    }
    try {
      await store.complete(invocationId, quote.id)
    } catch {
      // The API write succeeded; a bookkeeping failure must not turn success into a retry prompt.
      console.error('Could not record completed quote invocation')
    }
    return quote
  }
  async function capture(source: Message, member: GuildMember, settings: Settings) {
    if (
      !source.inGuild() ||
      source.guildId !== settings.guild_id ||
      source.author.id === client.user?.id
    )
      throw new UserError('That message cannot be saved as a quote.')
    await allowed(settings, source.channelId, member, true)
    const me = source.guild?.members.me
    if (
      !me ||
      !source.channel.permissionsFor(member)?.has(PermissionFlagsBits.ReadMessageHistory) ||
      !source.channel.permissionsFor(me)?.has(PermissionFlagsBits.ReadMessageHistory)
    )
      throw new UserError('The original message is not accessible.')
    if (!source.content.trim())
      throw new UserError(
        'That message has no text to save. Attachments and embeds are not supported.',
      )
    const author = await member.guild.members.fetch(source.author.id).catch(() => null)
    const mentions = new Map<string, string>()
    for (const match of source.content.matchAll(/<@!?(\d+)>/g)) {
      const id = match[1]
      if (!id || mentions.has(id)) continue
      // Limit lookups for hostile or unusually long input.
      const target =
        mentions.size < 25 ? await member.guild.members.fetch(id).catch(() => null) : null
      mentions.set(
        id,
        target?.displayName ?? source.mentions.users.get(id)?.username ?? `user-${id}`,
      )
    }
    const text = source.content
      .replace(/<@!?(\d+)>/g, (_, id: string) => `@${mentions.get(id) ?? `user-${id}`}`)
      .replace(
        /<#(\d+)>/g,
        (_, id: string) => `#${member.guild.channels.cache.get(id)?.name ?? `channel-${id}`}`,
      )
      .replace(
        /<@&(\d+)>/g,
        (_, id: string) => `@${member.guild.roles.cache.get(id)?.name ?? `role-${id}`}`,
      )
    return {
      quote: text,
      author: author?.displayName ?? source.author.globalName ?? source.author.username,
      date: source.createdAt.toISOString(),
      discord: {
        guild_id: settings.guild_id,
        submitter_id: member.id,
        message_id: source.id,
        author_id: source.author.id,
      },
    }
  }
  const settingsButtons = () => [
    row(
      button('settings:roles', 'Choose creator roles'),
      button('settings:everyone', 'Allow everyone'),
      button('settings:channels', 'Choose channels'),
    ),
    row(
      button('settings:everywhere', 'Allow all channels'),
      button('settings:disconnect', 'Disconnect collection', ButtonStyle.Danger),
    ),
  ]
  function policySummary(policy: Policy, label: string) {
    return `${label}: ${policy.mode === 'all' ? 'all' : policy.ids.length ? policy.ids.join(', ') : 'none'}`
  }

  async function handle(interaction: RepliableInteraction) {
    const modalCommand =
      interaction.isChatInputCommand() &&
      interaction.commandName === 'quote' &&
      ['create', 'setup'].includes(interaction.options.getSubcommand())
    // Modal responses cannot be deferred. Use the interaction's member snapshot here;
    // the submit handler rechecks current permissions, policies, and configuration.
    if (modalCommand && interaction.isChatInputCommand()) {
      if (interaction.guildId !== env.guildId)
        throw new UserError('Use this command in the configured server.')
      if (interaction.options.getSubcommand() === 'setup') {
        if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator))
          throw new UserError('Only Discord administrators can change bot settings.')
        await interaction.showModal(
          new ModalBuilder()
            .setCustomId('setup')
            .setTitle('Connect QuoteDB')
            .addComponents(
              field(
                'key',
                'Collection key (quotes:read + quotes:write)',
                TextInputStyle.Short,
                300,
              ),
            ),
        )
      } else {
        const name = interaction.inCachedGuild()
          ? interaction.member.displayName
          : (interaction.user.globalName ?? interaction.user.username)
        const date = field('date', 'Date (YYYY-MM-DD, optional)', TextInputStyle.Short, 10)
        date.components[0]?.setRequired(false)
        await interaction.showModal(
          new ModalBuilder()
            .setCustomId('create')
            .setTitle('Create quote')
            .addComponents(
              field('quote', 'Quote (up to 4,000 characters)', TextInputStyle.Paragraph, 4000),
              field('author', 'Author', TextInputStyle.Short, 255, name),
              date,
            ),
        )
      }
      return
    }
    // A modal must be the initial response. Other handlers acknowledge before I/O.
    if (!modalCommand) {
      if (interaction.isButton() && interaction.customId.startsWith('page:')) {
        getSession(interaction, interaction.customId.split(':')[1])
        await interaction.deferUpdate()
      } else {
        const privateReply =
          !(
            interaction.isChatInputCommand() &&
            !['settings', 'setup'].includes(
              interaction.commandName === 'quote' ? interaction.options.getSubcommand() : 'izaro',
            )
          ) &&
          !interaction.isMessageContextMenuCommand() &&
          !(interaction.isModalSubmit() && interaction.customId === 'create')
        await interaction.deferReply(privateReply ? { flags: MessageFlags.Ephemeral } : {})
      }
    }
    const { member, settings } = await context(interaction.guildId, interaction.user.id)
    const channelId = interaction.channelId
    if (!channelId) throw new UserError('Use this command in a server channel.')

    if (interaction.isChatInputCommand()) {
      const name =
        interaction.commandName === 'quote'
          ? interaction.options.getSubcommand()
          : interaction.commandName
      if (name === 'settings') {
        requireAdmin(member)
        await interaction.editReply({
          content: `Collection: ${settings.collection_name ?? 'not connected'}\nKey: ${settings.token_prefix ?? 'none'}\n${policySummary(settings.creator_roles, 'Creator roles')}\n${policySummary(settings.channels, 'Channels')}\nSelect a change below; you will confirm before saving.`,
          components: settingsButtons(),
          allowedMentions: { parse: [] },
        })
        return
      }
      await allowed(settings, channelId, member)
      throttle(settings.guild_id, member.id)
      if (name === 'izaro') {
        await interaction.editReply(display([await publicApi.public.izaro()], 'Random Izaro Quote'))
      } else if (name === 'random') {
        const result = await api(settings).quotes.random({
          max: interaction.options.getInteger('count') ?? 5,
        })
        await showPages(
          interaction,
          settings,
          'Random Quotes',
          result.quotes.slice(0, 5),
          undefined,
          undefined,
          result.quotes,
        )
      } else if (name === 'list' || name === 'search') {
        const query =
          name === 'search'
            ? {
                q: interaction.options.getString('text', true),
                author: interaction.options.getString('author') ?? undefined,
              }
            : {}
        const result = await api(settings).quotes.list({ ...query, max: 5 })
        await showPages(
          interaction,
          settings,
          name === 'search' ? 'Search Results' : 'Recent Quotes',
          result.quotes,
          result.next_cursor,
          query,
        )
      }
      return
    }
    if (interaction.isModalSubmit()) {
      if (interaction.customId === 'setup') {
        requireAdmin(member)
        const token = interaction.fields.getTextInputValue('key').trim()
        const info = await createApiClient({
          baseUrl: env.apiUrl,
          bearerToken: token,
          timeoutMs: 8_000,
        }).tokenInfo()
        if (info.kind !== 'collection')
          throw new UserError(
            'Use a collection integration token from Manage collections in QuoteDB, not a personal API token.',
          )
        if (!info.scopes.includes('quotes:read') || !info.scopes.includes('quotes:write'))
          throw new UserError('The API key needs both quotes:read and quotes:write scopes.')
        const id = remember(interaction, {
          kind: 'connect',
          credential: encrypt(env.key, settings.guild_id, token),
          info,
          revision: settings.revision,
        })
        await interaction.editReply({
          content: `Connect this server to “${info.collection.name}” (${info.collection.id})? Members will be able to read that collection’s quotes and permitted members can add quotes. This replaces any existing connection. Key: ${info.prefix}`,
          components: [row(button(`confirm:${id}`, 'Connect collection', ButtonStyle.Primary))],
          allowedMentions: { parse: [] },
        })
      } else if (interaction.customId === 'create') {
        await allowed(settings, channelId, member, true)
        throttle(settings.guild_id, member.id)
        const date = interaction.fields.getTextInputValue('date').trim()
        if (
          date &&
          (!/^\d{4}-\d{2}-\d{2}$/.test(date) ||
            !Number.isFinite(Date.parse(date)) ||
            new Date(date).toISOString().slice(0, 10) !== date)
        )
          throw new UserError('Use a valid date in YYYY-MM-DD format.')
        const quote = await save(settings, interaction.id, {
          quote: interaction.fields.getTextInputValue('quote').trim(),
          discord: { guild_id: settings.guild_id, submitter_id: member.id },
          author: interaction.fields.getTextInputValue('author').trim(),
          ...(date ? { date } : {}),
        })
        await interaction.editReply(display([quote], 'New Quote Created'))
      }
      return
    }
    if (interaction.isMessageContextMenuCommand()) {
      await allowed(settings, channelId, member, true)
      throttle(settings.guild_id, member.id)
      const source = await interaction.targetMessage.fetch()
      const quote = await save(settings, interaction.id, await capture(source, member, settings))
      await interaction.editReply(display([quote], 'New Quote Created'))
      return
    }
    if (interaction.isButton() && interaction.customId.startsWith('page:')) {
      const [, id, direction] = interaction.customId.split(':')
      const session = getSession(interaction, id)
      if (session.kind !== 'page' || session.revision !== settings.revision)
        throw new UserError('The connection or settings changed. Run the command again.')
      await allowed(settings, channelId, member)
      if (session.busy) return
      session.busy = true
      try {
        const target = session.page + (direction === 'next' ? 1 : -1)
        if (target < 0) return
        if (target === session.pages.length && session.query) {
          const next = session.pages[session.page]?.next
          if (!next) return
          throttle(settings.guild_id, member.id)
          const result = await api(settings).quotes.list({ ...session.query, max: 5, cursor: next })
          session.pages.push({ quotes: result.quotes, next: result.next_cursor })
        }
        const page = session.pages[target]
        if (!page) return
        session.page = target
        await interaction.editReply({
          ...display(page.quotes, session.title, target + 1),
          attachments: [],
          components: pageButtons(id ?? '', session),
        })
      } finally {
        session.busy = false
      }
      return
    }
    requireAdmin(member)
    if (interaction.isButton() && interaction.customId.startsWith('settings:')) {
      const action = interaction.customId.split(':')[1]
      if (action === 'roles') {
        await interaction.editReply({
          content:
            'Select roles allowed to create quotes. An empty selection allows only administrators.',
          components: [
            new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(
              new RoleSelectMenuBuilder()
                .setCustomId('select:creator_roles')
                .setMinValues(0)
                .setMaxValues(25),
            ),
          ],
        })
      } else if (action === 'channels') {
        await interaction.editReply({
          content:
            'Select allowed channels. Threads inherit their parent channel. An empty selection disables quote commands.',
          components: [
            new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
              new ChannelSelectMenuBuilder()
                .setCustomId('select:channels')
                .setChannelTypes(
                  ChannelType.GuildText,
                  ChannelType.GuildAnnouncement,
                  ChannelType.GuildForum,
                  ChannelType.PublicThread,
                  ChannelType.PrivateThread,
                )
                .setMinValues(0)
                .setMaxValues(25),
            ),
          ],
        })
      } else {
        const id =
          action === 'disconnect'
            ? remember(interaction, { kind: 'disconnect' })
            : remember(interaction, {
                kind: 'policy',
                target: action === 'everyone' ? 'creator_roles' : 'channels',
                policy: { mode: 'all', ids: [] },
              })
        await interaction.editReply({
          content:
            action === 'disconnect'
              ? 'Disconnect this server? Existing quotes and the API token in QuoteDB will remain.'
              : `Confirm ${action === 'everyone' ? 'allowing everyone to create quotes' : 'allowing quote commands in all channels'}?`,
          components: [row(button(`confirm:${id}`, 'Confirm', ButtonStyle.Primary))],
        })
      }
    } else if (interaction.isRoleSelectMenu() || interaction.isChannelSelectMenu()) {
      const target = interaction.customId === 'select:creator_roles' ? 'creator_roles' : 'channels'
      const policy: Policy = { mode: 'selected', ids: interaction.values }
      const id = remember(interaction, { kind: 'policy', target, policy })
      await interaction.editReply({
        content: `${policySummary(policy, target)}\nSave this restriction?`,
        components: [row(button(`confirm:${id}`, 'Save settings', ButtonStyle.Primary))],
      })
    } else if (interaction.isButton() && interaction.customId.startsWith('confirm:')) {
      const id = interaction.customId.split(':')[1]
      const session = getSession(interaction, id)
      sessions.delete(id ?? '')
      if (session.kind === 'connect') {
        const token = decrypt(env.key, settings.guild_id, session.credential)
        const info = await createApiClient({
          baseUrl: env.apiUrl,
          bearerToken: token,
          timeoutMs: 8_000,
        }).tokenInfo()
        if (info.kind !== 'collection')
          throw new UserError(
            'Use a collection integration token from Manage collections in QuoteDB, not a personal API token.',
          )
        if (!info.scopes.includes('quotes:read') || !info.scopes.includes('quotes:write'))
          throw new UserError('This key no longer has the required scopes.')
        if (
          !(await store.connect(
            settings.guild_id,
            member.id,
            session.credential,
            info.collection,
            info.prefix,
            session.revision,
          ))
        )
          throw new UserError('Settings changed while setup was open. Run /quote setup again.')
      } else if (session.kind === 'disconnect') {
        await store.disconnect(settings.guild_id, member.id)
      } else if (session.kind === 'policy') {
        await store.policy(settings.guild_id, member.id, session.target, session.policy)
      } else throw new UserError('Invalid control.')
      console.info(
        JSON.stringify({
          event: 'settings.updated',
          guild: settings.guild_id,
          actor: member.id,
          action: session.kind,
        }),
      )
      await interaction.editReply({ content: 'Settings saved.', components: [] })
    }
  }

  return {
    async interaction(interaction: Interaction) {
      if (!interaction.isRepliable()) return
      try {
        await handle(interaction)
      } catch (error) {
        console.error(
          JSON.stringify({
            event: 'interaction.failed',
            id: interaction.id,
            guild: interaction.guildId,
            category:
              error instanceof ApiError
                ? `api.${error.status}`
                : error instanceof UserError
                  ? 'user'
                  : 'internal',
          }),
        )
        const content = userMessage(error)
        try {
          if (
            interaction.isButton() &&
            interaction.customId.startsWith('page:') &&
            interaction.deferred
          )
            await interaction.followUp({ content, flags: MessageFlags.Ephemeral })
          else if (interaction.deferred || interaction.replied)
            await interaction.editReply({ content, components: [], embeds: [] })
          else await interaction.reply({ content, flags: MessageFlags.Ephemeral })
        } catch {
          console.error('Could not deliver interaction error')
        }
      }
    },
    async message(message: Message) {
      if (
        message.author.bot ||
        message.guildId !== env.guildId ||
        !client.user ||
        !message.mentions.users.has(client.user.id)
      )
        return
      try {
        const { member, settings } = await context(message.guildId, message.author.id)
        await allowed(settings, message.channelId, member, true)
        throttle(settings.guild_id, member.id)
        if (!message.reference?.messageId)
          throw new UserError('Reply to a message and mention me to save it, or use /quote create.')
        const source = await message.fetchReference().catch(() => {
          throw new UserError('The original message could not be found or accessed.')
        })
        const quote = await save(settings, message.id, await capture(source, member, settings))
        await message.reply(display([quote], 'New Quote Created'))
      } catch (error) {
        console.error(
          JSON.stringify({
            event: 'capture.failed',
            id: message.id,
            category: error instanceof UserError ? 'user' : 'request',
          }),
        )
        await message
          .reply({
            content: userMessage(error),
            allowedMentions: { parse: [], repliedUser: false },
          })
          .catch(() => {})
      }
    },
    stop() {
      clearInterval(timer)
      sessions.clear()
    },
  }
}
