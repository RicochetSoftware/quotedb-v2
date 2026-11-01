import { randomBytes } from 'node:crypto'
import { ApiError } from '@quotedb/shared'
import type { Client, Interaction, Message } from 'discord.js'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createBot, userMessage } from '../src/bot.js'
import type { Settings, Store } from '../src/db/store.js'
import type { Env } from '../src/env.js'
import { encrypt } from '../src/security/credentials.js'

const env: Env = {
  token: 'discord-secret',
  guildIds: ['123', '456'],
  key: randomBytes(32),
  databaseUrl: 'unused',
  apiUrl: 'https://api.example',
  publicUrl: 'https://quotes.example',
}
const quote = {
  id: 'id',
  quote: 'hello',
  author: 'Ada',
  date: '2020-01-01',
  created_at: '2020-01-01T00:00:00Z',
  updated_at: '2020-01-01T00:00:00Z',
}
let settings: Settings
let bot: ReturnType<typeof createBot>
let store: Store
let transport: ReturnType<typeof vi.fn<typeof fetch>>
let administrator = false
const permissions = { has: () => true }
const channel = {
  id: 'channel',
  parentId: null,
  isThread: () => false,
  permissionsFor: () => permissions,
}
const member = {
  id: 'user',
  displayName: 'Server Nick',
  permissions: { has: () => administrator },
  roles: { cache: new Map([['member-role', {}]]) },
  guild: {},
}
const guild = {
  ownerId: 'owner',
  members: {
    fetch: vi.fn(async (_id?: unknown) => member),
    me: member as typeof member | null,
    fetchMe: vi.fn(async () => member),
  },
  channels: { fetch: vi.fn(async () => channel), cache: new Map() },
  roles: { cache: new Map() },
}
member.guild = guild
function event(
  type: 'slash' | 'modal' | 'button' | 'context',
  name: string,
  extras: Record<string, unknown> = {},
) {
  const e = {
    id: 'invocation',
    guildId: '123',
    channelId: 'channel',
    user: { id: 'user' },
    inCachedGuild: () => false,
    memberPermissions: { has: () => administrator },
    commandName: name === 'izaro' ? 'izaro' : 'quote',
    customId: name,
    options: { getSubcommand: () => name, getInteger: () => null, getString: () => 'needle' },
    isRepliable: () => true,
    isChatInputCommand: () => type === 'slash',
    isButton: () => type === 'button',
    isModalSubmit: () => type === 'modal',
    isMessageContextMenuCommand: () => type === 'context',
    isRoleSelectMenu: () => false,
    isChannelSelectMenu: () => false,
    deferred: false,
    replied: false,
    deferReply: vi.fn(async () => {
      e.deferred = true
    }),
    deferUpdate: vi.fn(async () => {
      e.deferred = true
    }),
    editReply: vi.fn(async (_payload: unknown) => {}),
    reply: vi.fn(async () => {}),
    followUp: vi.fn(async () => {}),
    showModal: vi.fn(async () => {}),
    ...extras,
  }
  return e
}
const send = (e: ReturnType<typeof event>) => bot.interaction(e as unknown as Interaction)
beforeEach(() => {
  administrator = false
  guild.members.fetch.mockReset().mockResolvedValue(member)
  guild.members.me = member
  guild.channels.cache.clear()
  guild.roles.cache.clear()
  settings = {
    guild_id: '123',
    credential: encrypt(env.key, '123', 'quotedb-secret'),
    collection_id: 'owner',
    collection_name: 'Server',
    token_prefix: 'prefix',
    revision: 'v1',
    creator_roles: { mode: 'all', ids: [] },
    channels: { mode: 'all', ids: [] },
  }
  store = {
    get: vi.fn(async () => settings),
    claim: vi.fn(async () => true),
    complete: vi.fn(async () => {}),
    connect: vi.fn(async () => true),
    disconnect: vi.fn(async () => {}),
    policy: vi.fn(async () => {}),
    health: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
  }
  const client = {
    guilds: { fetch: async () => guild },
    user: { id: 'bot', username: 'QuoteDB' },
  } as unknown as Client
  transport = vi
    .fn<typeof fetch>()
    .mockImplementation(async () => new Response(JSON.stringify({ quotes: [quote] })))
  vi.stubGlobal('fetch', transport)
  bot = createBot(client, env, store)
})
afterEach(() => {
  bot.stop()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
  vi.restoreAllMocks()
  vi.useRealTimers()
})
it('reads five random quotes using only this server credential', async () => {
  const e = event('slash', 'random')
  await send(e)
  expect(transport.mock.calls[0]?.[0].toString()).toBe(
    'https://api.example/api/v1/quotes/random?max=5',
  )
  expect(transport.mock.calls[0]?.[1]?.headers).toMatchObject({
    authorization: 'Bearer quotedb-secret',
  })
  expect(e.editReply.mock.calls[0]?.[0]).toMatchObject({ embeds: expect.any(Array) })
})
it('uses the public izaro endpoint without a server key', async () => {
  settings.credential = null
  transport.mockResolvedValue(new Response(JSON.stringify(quote)))
  const e = event('slash', 'izaro')
  await send(e)
  expect(transport.mock.calls[0]?.[0].toString()).toBe('https://api.example/api/v1/public/izaro')
  expect(transport.mock.calls[0]?.[1]?.headers).toEqual({})
  expect(e.editReply).toHaveBeenCalled()
})
it('keeps izaro subject to channel restrictions', async () => {
  settings.channels = { mode: 'selected', ids: [] }
  const e = event('slash', 'izaro')
  await send(e)
  expect(transport).not.toHaveBeenCalled()
  expect(e.editReply).toHaveBeenCalledWith(
    expect.objectContaining({ content: expect.stringContaining('not enabled') }),
  )
})
it('denies setup and forged setup submissions by non-admins', async () => {
  const slash = event('slash', 'setup')
  await send(slash)
  expect(slash.showModal).not.toHaveBeenCalled()
  const submit = event('modal', 'setup', { fields: { getTextInputValue: () => 'secret' } })
  await send(submit)
  expect(transport).not.toHaveBeenCalled()
  expect(store.connect).not.toHaveBeenCalled()
})
it('validates scopes and keeps a failed setup from replacing the account', async () => {
  administrator = true
  transport.mockResolvedValue(
    new Response(
      JSON.stringify({
        kind: 'collection',
        collection: { id: 'owner', name: 'Owner', kind: 'shared' },
        scopes: ['quotes:read'],
        prefix: 'safe',
        expires_at: null,
      }),
    ),
  )
  const submit = event('modal', 'setup', {
    fields: { getTextInputValue: () => 'candidate-secret' },
  })
  await send(submit)
  expect(store.connect).not.toHaveBeenCalled()
  expect(submit.editReply).toHaveBeenCalledWith(
    expect.objectContaining({ content: expect.stringContaining('both quotes:read') }),
  )
})
it('requires confirmation and stores only encrypted setup credentials', async () => {
  administrator = true
  transport.mockImplementation(
    async () =>
      new Response(
        JSON.stringify({
          kind: 'collection',
          collection: { id: 'owner', name: 'Owner', kind: 'shared' },
          scopes: ['quotes:read', 'quotes:write'],
          prefix: 'safe',
          expires_at: null,
        }),
      ),
  )
  const submit = event('modal', 'setup', {
    fields: { getTextInputValue: () => 'candidate-secret' },
  })
  await send(submit)
  expect(store.connect).not.toHaveBeenCalled()
  const payload = submit.editReply.mock.calls[0]?.[0] as unknown as {
    components: { components: { data: { custom_id: string } }[] }[]
  }
  const id = payload.components[0]?.components[0]?.data.custom_id ?? ''
  await send(event('button', id))
  expect(store.connect).toHaveBeenCalledWith(
    '123',
    'user',
    expect.not.stringContaining('candidate-secret'),
    { id: 'owner', name: 'Owner', kind: 'shared' },
    'safe',
    'v1',
  )
})
it('rejects manual creation when roles change while its form is open', async () => {
  settings.creator_roles = { mode: 'selected', ids: [] }
  await send(event('modal', 'create', { fields: { getTextInputValue: () => 'text' } }))
  expect(store.claim).not.toHaveBeenCalled()
  expect(transport).not.toHaveBeenCalled()
})
it('saves manual text and author and does not retry an ambiguous write', async () => {
  transport.mockRejectedValue(new Error('network'))
  const e = event('modal', 'create', {
    fields: {
      getTextInputValue: (name: string) =>
        ({
          quote: 'hello',
          author: 'Free author',
          date: '2020-01-02',
          discord: { guild_id: '123', submitter_id: 'user' },
        })[name],
    },
  })
  await send(e)
  expect(transport).toHaveBeenCalledTimes(1)
  expect(JSON.parse(String(transport.mock.calls[0]?.[1]?.body))).toEqual({
    quote: 'hello',
    author: 'Free author',
    date: '2020-01-02',
    discord: { guild_id: '123', submitter_id: 'user' },
  })
  expect(e.editReply).toHaveBeenCalledWith(
    expect.objectContaining({ content: expect.stringContaining('may have succeeded') }),
  )
})
it('does not repeat a claimed creation', async () => {
  vi.mocked(store.claim).mockResolvedValue(false)
  await send(
    event('modal', 'create', {
      fields: { getTextInputValue: (name: string) => (name === 'date' ? '' : 'hello') },
    }),
  )
  expect(transport).not.toHaveBeenCalled()
})
it('captures the original message text, author display name, and timestamp', async () => {
  transport.mockResolvedValue(new Response(JSON.stringify(quote)))
  const source = {
    inGuild: () => true,
    guildId: '123',
    guild,
    author: { id: 'author', username: 'Original' },
    channelId: 'channel',
    channel,
    content: 'original words',
    createdAt: new Date('2019-03-04T12:34:56Z'),
    mentions: { users: new Map() },
  }
  const e = event('context', 'Save quote', { targetMessage: { fetch: async () => source } })
  await send(e)
  expect(JSON.parse(String(transport.mock.calls[0]?.[1]?.body))).toEqual({
    quote: 'original words',
    author: 'Server Nick',
    date: '2019-03-04T12:34:56.000Z',
    discord: { guild_id: '123', submitter_id: 'user', author_id: 'author' },
  })
})
it('reply capture uses the referenced message, not the mentioning reply', async () => {
  transport.mockResolvedValue(new Response(JSON.stringify(quote)))
  const source = {
    inGuild: () => true,
    guildId: '123',
    guild,
    author: { id: 'author', username: 'Original' },
    channelId: 'channel',
    channel,
    content: 'source words',
    createdAt: new Date('2019-01-01Z'),
    mentions: { users: new Map() },
  }
  const reply = vi.fn()
  await bot.message({
    id: 'message-event',
    guildId: '123',
    channelId: 'channel',
    author: { bot: false, id: 'user' },
    mentions: { users: new Map([['bot', {}]]) },
    reference: { messageId: 'source' },
    fetchReference: async () => source,
    reply,
  } as unknown as Message)
  expect(JSON.parse(String(transport.mock.calls[0]?.[1]?.body)).quote).toBe('source words')
  expect(reply).toHaveBeenCalled()
})
it('rejects another user’s pagination control without changing public results', async () => {
  const first = event('slash', 'list')
  await send(first)
  const payload = first.editReply.mock.calls[0]?.[0] as unknown as {
    components: { components: { data: { custom_id: string } }[] }[]
  }
  const id = payload.components[0]?.components[1]?.data.custom_id ?? ''
  const click = event('button', id, { user: { id: 'other' } })
  await send(click)
  expect(click.deferUpdate).not.toHaveBeenCalled()
  expect(click.reply).toHaveBeenCalledWith(
    expect.objectContaining({ content: expect.stringContaining('belong') }),
  )
})

it('opens setup immediately without waiting for the database', async () => {
  administrator = true
  const e = event('slash', 'setup')
  await send(e)
  expect(e.showModal).toHaveBeenCalled()
  expect(store.get).not.toHaveBeenCalled()
})
it('prefills the manual author from the invoking member display name', async () => {
  const e = event('slash', 'create', {
    inCachedGuild: () => true,
    member: { displayName: 'Nickname' },
  })
  await send(e)
  expect(JSON.stringify(e.showModal.mock.calls)).toContain('Nickname')
  expect(store.get).not.toHaveBeenCalled()
})
it('rejects expired pagination sessions', async () => {
  vi.useFakeTimers()
  try {
    const first = event('slash', 'list')
    await send(first)
    const payload = first.editReply.mock.calls[0]?.[0] as unknown as {
      components: { components: { data: { custom_id: string } }[] }[]
    }
    const id = payload.components[0]?.components[1]?.data.custom_id ?? ''
    vi.advanceTimersByTime(11 * 60_000)
    const click = event('button', id)
    await send(click)
    expect(click.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('expired') }),
    )
  } finally {
    vi.useRealTimers()
  }
})
it('fetches the next cursor page and reuses previous pages', async () => {
  vi.useFakeTimers()
  try {
    transport.mockResolvedValueOnce(
      new Response(JSON.stringify({ quotes: [quote], next_cursor: 'next-cursor' })),
    )
    const first = event('slash', 'search')
    await send(first)
    const payload = first.editReply.mock.calls[0]?.[0] as unknown as {
      components: { components: { data: { custom_id: string } }[] }[]
    }
    const next = payload.components[0]?.components[1]?.data.custom_id ?? ''
    vi.advanceTimersByTime(4000)
    const click = event('button', next)
    await send(click)
    expect(transport.mock.calls[1]?.[0].toString()).toContain('cursor=next-cursor')
    expect(transport.mock.calls[1]?.[0].toString()).toContain('q=needle')
    await send(event('button', next.replace(':next', ':prev')))
    expect(transport).toHaveBeenCalledTimes(2)
  } finally {
    vi.useRealTimers()
  }
})
it('invalidates pages when the account or policy changes', async () => {
  const first = event('slash', 'list')
  await send(first)
  const payload = first.editReply.mock.calls[0]?.[0] as unknown as {
    components: { components: { data: { custom_id: string } }[] }[]
  }
  settings.revision = 'v2'
  const click = event('button', payload.components[0]?.components[1]?.data.custom_id ?? '')
  await send(click)
  expect(click.followUp).toHaveBeenCalledWith(
    expect.objectContaining({ content: expect.stringContaining('changed') }),
  )
})
it('rejects invalid dates without writing', async () => {
  const e = event('modal', 'create', {
    fields: { getTextInputValue: (name: string) => (name === 'date' ? '2025-02-30' : 'text') },
  })
  await send(e)
  expect(transport).not.toHaveBeenCalled()
  expect(e.editReply).toHaveBeenCalledWith(
    expect.objectContaining({ content: expect.stringContaining('valid date') }),
  )
})
it('handles API unavailability without exposing raw errors or credentials', async () => {
  transport.mockRejectedValue(new Error('request failed secret=quotedb-secret'))
  const e = event('slash', 'izaro')
  await send(e)
  expect(JSON.stringify(e.editReply.mock.calls)).not.toContain('quotedb-secret')
  expect(e.editReply).toHaveBeenCalledWith(
    expect.objectContaining({ content: expect.stringContaining('try again later') }),
  )
})
it('rejects context capture of textless messages', async () => {
  const source = {
    inGuild: () => true,
    guildId: '123',
    guild,
    author: { id: 'author' },
    channelId: 'channel',
    channel,
    content: '',
  }
  const e = event('context', 'Save quote', { targetMessage: { fetch: async () => source } })
  await send(e)
  expect(store.claim).not.toHaveBeenCalled()
  expect(e.editReply).toHaveBeenCalledWith(
    expect.objectContaining({ content: expect.stringContaining('no text') }),
  )
})
it('requires confirmation before disconnecting', async () => {
  administrator = true
  const e = event('button', 'settings:disconnect')
  await send(e)
  expect(store.disconnect).not.toHaveBeenCalled()
  const payload = e.editReply.mock.calls[0]?.[0] as unknown as {
    components: { components: { data: { custom_id: string } }[] }[]
  }
  await send(event('button', payload.components[0]?.components[0]?.data.custom_id ?? ''))
  expect(store.disconnect).toHaveBeenCalledWith('123', 'user')
})
it('requires confirmation before enabling all channels', async () => {
  administrator = true
  const e = event('button', 'settings:everywhere')
  await send(e)
  expect(store.policy).not.toHaveBeenCalled()
  const payload = e.editReply.mock.calls[0]?.[0] as unknown as {
    components: { components: { data: { custom_id: string } }[] }[]
  }
  await send(event('button', payload.components[0]?.components[0]?.data.custom_id ?? ''))
  expect(store.policy).toHaveBeenCalledWith('123', 'user', 'channels', { mode: 'all', ids: [] })
})

it('uses separate credentials for another allowed server', async () => {
  settings = {
    ...settings,
    guild_id: '456',
    credential: encrypt(env.key, '456', 'second-server-key'),
  }
  transport.mockResolvedValue(new Response(JSON.stringify({ quotes: [quote] }), { status: 200 }))
  const interaction = event('slash', 'random', { guildId: '456' })
  await send(interaction)
  expect(store.get).toHaveBeenCalledWith('456')
  expect(transport).toHaveBeenCalled()
  const headers = new Headers(transport.mock.calls[0]?.[1]?.headers)
  expect(headers.get('authorization')).toBe('Bearer second-server-key')
})
it('rejects commands and forms from servers outside the allowlist', async () => {
  await send(event('slash', 'random', { guildId: '789' }))
  await send(event('slash', 'create', { guildId: '789' }))
  expect(store.get).not.toHaveBeenCalled()
  expect(transport).not.toHaveBeenCalled()
})

function controlId(e: ReturnType<typeof event>, index = 0) {
  const payload = e.editReply.mock.calls[0]?.[0] as {
    components: { components: { data: { custom_id: string } }[] }[]
  }
  const id = payload.components[0]?.components[index]?.data.custom_id
  if (!id) throw new Error('Expected a component custom ID')
  return id
}
const tokenInfo = {
  kind: 'collection',
  collection: { id: 'owner', name: 'Owner', kind: 'shared' },
  scopes: ['quotes:read', 'quotes:write'],
  prefix: 'safe',
  expires_at: null,
}
const manual = () =>
  event('modal', 'create', {
    fields: { getTextInputValue: (name: string) => (name === 'date' ? '' : 'hello') },
  })
function sourceMessage(overrides: Record<string, unknown> = {}) {
  return {
    id: 'source',
    inGuild: () => true,
    guildId: '123',
    guild,
    author: { id: 'author', username: 'Original' },
    channelId: 'channel',
    channel,
    content: 'source words',
    createdAt: new Date('2019-01-01Z'),
    mentions: { users: new Map() },
    ...overrides,
  }
}
function mentioningMessage(overrides: Record<string, unknown> = {}) {
  return {
    id: 'message-event',
    guildId: '123',
    channelId: 'channel',
    author: { bot: false, id: 'user' },
    mentions: { users: new Map([['bot', {}]]) },
    reference: { messageId: 'source' },
    fetchReference: vi.fn(async () => sourceMessage()),
    reply: vi.fn(async () => {}),
    ...overrides,
  }
}

it.each([
  [401, 'connection needs attention'],
  [403, 'connection needs attention'],
  [429, 'wait a minute'],
  [404, 'No quotes'],
  [400, 'Check the text'],
  [500, 'try again later'],
])('gives actionable, credential-free feedback for HTTP %i', (status, message) => {
  expect(userMessage(new ApiError(Number(status), 'private server detail', null))).toContain(
    message,
  )
  expect(userMessage(new ApiError(Number(status), 'private server detail', null))).not.toContain(
    'private server detail',
  )
})

it('prompts an unconnected server to set up its collection', async () => {
  settings.credential = null
  const e = event('slash', 'random')
  await send(e)
  expect(e.editReply).toHaveBeenCalledWith(
    expect.objectContaining({ content: expect.stringContaining('not connected') }),
  )
  expect(transport).not.toHaveBeenCalled()
})

it.each([false, true])(
  'checks current channel permissions (bot permissions: %s)',
  async (botPermissions) => {
    vi.spyOn(permissions, 'has').mockImplementation((...args: unknown[]) =>
      botPermissions ? !Array.isArray(args[0]) : false,
    )
    const e = event('slash', 'random')
    await send(e)
    expect(e.editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining(botPermissions ? 'bot needs permission' : 'cannot access'),
      }),
    )
    expect(transport).not.toHaveBeenCalled()
  },
)

it('throttles repeated commands and permits them after the cooldown', async () => {
  vi.useFakeTimers()
  await send(event('slash', 'random'))
  const repeated = event('slash', 'random')
  await send(repeated)
  expect(transport).toHaveBeenCalledTimes(1)
  expect(repeated.editReply).toHaveBeenCalledWith(
    expect.objectContaining({ content: expect.stringContaining('wait a moment') }),
  )
  vi.advanceTimersByTime(4000)
  await send(event('slash', 'random'))
  expect(transport).toHaveBeenCalledTimes(2)
})

it('bounds pending confirmations and frees expired controls for new commands', async () => {
  bot.stop()
  vi.useFakeTimers()
  bot = createBot(
    { guilds: { fetch: async () => guild }, user: { id: 'bot' } } as unknown as Client,
    env,
    store,
  )
  administrator = true
  const first = event('button', 'settings:disconnect')
  await send(first)
  // Also populate the cooldown map so timer cleanup covers both resource types.
  await send(event('slash', 'izaro'))
  for (let i = 1; i < 1000; i++) await send(event('button', 'settings:disconnect'))
  const overflow = event('button', 'settings:disconnect')
  await send(overflow)
  expect(overflow.editReply).toHaveBeenCalledWith(
    expect.objectContaining({ content: expect.stringContaining('bot is busy') }),
  )
  await vi.advanceTimersByTimeAsync(11 * 60_000)
  const stale = event('button', controlId(first))
  await send(stale)
  expect(stale.editReply).toHaveBeenCalledWith(
    expect.objectContaining({ content: expect.stringContaining('expired') }),
  )
  const fresh = event('button', 'settings:disconnect')
  await send(fresh)
  await send(event('button', controlId(fresh)))
  expect(store.disconnect).toHaveBeenCalledExactlyOnceWith('123', 'user')
})

it('reports a successful save even if recording completion fails', async () => {
  transport.mockResolvedValue(new Response(JSON.stringify(quote)))
  vi.mocked(store.complete).mockRejectedValue(new Error('database offline'))
  const log = vi.spyOn(console, 'error').mockImplementation(() => {})
  const e = manual()
  await send(e)
  expect(store.complete).toHaveBeenCalledWith('invocation', quote.id)
  expect(e.editReply).toHaveBeenCalledWith(expect.objectContaining({ embeds: expect.any(Array) }))
  expect(log).toHaveBeenCalledWith('Could not record completed quote invocation')
  expect(transport).toHaveBeenCalledTimes(1)
})

it.each([{ guildId: 'other' }, { author: { id: 'bot' } }, { inGuild: () => false }])(
  'rejects capture of a message outside its allowed source: %j',
  async (overrides) => {
    const e = event('context', 'Save quote', {
      targetMessage: { fetch: async () => sourceMessage(overrides) },
    })
    await send(e)
    expect(e.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('cannot be saved') }),
    )
    expect(store.claim).not.toHaveBeenCalled()
  },
)

it('requires permission to read the original message history', async () => {
  const e = event('context', 'Save quote', {
    targetMessage: {
      fetch: async () =>
        sourceMessage({ channel: { permissionsFor: () => ({ has: () => false }) } }),
    },
  })
  await send(e)
  expect(e.editReply).toHaveBeenCalledWith(
    expect.objectContaining({ content: expect.stringContaining('not accessible') }),
  )
  expect(store.claim).not.toHaveBeenCalled()
})

it('resolves mentions without pinging anyone and falls back when members have left', async () => {
  transport.mockResolvedValue(new Response(JSON.stringify(quote)))
  guild.members.fetch.mockImplementation(async (id?: unknown) => {
    if (typeof id === 'object' || id === '1') return member
    throw new Error('Unknown member')
  })
  guild.channels.cache.set('3', { name: 'general' })
  guild.roles.cache.set('4', { name: 'Readers' })
  const source = sourceMessage({
    content: '<@1> <@!1> <@2> <@5> <#3> <#6> <@&4> <@&7>',
    mentions: { users: new Map([['2', { username: 'Former member' }]]) },
  })
  const e = event('context', 'Save quote', { targetMessage: { fetch: async () => source } })
  await send(e)
  expect(JSON.parse(String(transport.mock.calls[0]?.[1]?.body))).toMatchObject({
    quote: '@Server Nick @Server Nick @Former member @user-5 #general #channel-6 @Readers @role-7',
    author: 'Original',
  })
  expect(guild.members.fetch.mock.calls.filter(([id]) => id === '1')).toHaveLength(1)
  guild.channels.cache.clear()
  guild.roles.cache.clear()
})

it('shows current connection and policy settings without exposing the credential', async () => {
  administrator = true
  settings.creator_roles = { mode: 'selected', ids: ['role-a'] }
  settings.channels = { mode: 'selected', ids: [] }
  const e = event('slash', 'settings')
  await send(e)
  expect(e.editReply).toHaveBeenCalledWith(
    expect.objectContaining({
      content: expect.stringContaining('Creator roles: role-a\nChannels: none'),
    }),
  )
  expect(JSON.stringify(e.editReply.mock.calls)).not.toContain('quotedb-secret')
})

it.each(['roles', 'channels'])(
  'requires confirmation before saving selected %s',
  async (action) => {
    administrator = true
    const e = event('button', `settings:${action}`)
    await send(e)
    expect(controlId(e)).toBe(action === 'roles' ? 'select:creator_roles' : 'select:channels')
    const selected = event('button', controlId(e), {
      isButton: () => false,
      isRoleSelectMenu: () => action === 'roles',
      isChannelSelectMenu: () => action === 'channels',
      values: ['selected-id'],
    })
    await send(selected)
    expect(store.policy).not.toHaveBeenCalled()
    await send(event('button', controlId(selected)))
    expect(store.policy).toHaveBeenCalledWith(
      '123',
      'user',
      action === 'roles' ? 'creator_roles' : 'channels',
      { mode: 'selected', ids: ['selected-id'] },
    )
  },
)

it('rejects personal credentials at setup', async () => {
  administrator = true
  transport.mockResolvedValue(new Response(JSON.stringify({ ...tokenInfo, kind: 'personal' })))
  const e = event('modal', 'setup', { fields: { getTextInputValue: () => 'candidate-secret' } })
  await send(e)
  expect(e.editReply).toHaveBeenCalledWith(
    expect.objectContaining({ content: expect.stringContaining('collection integration token') }),
  )
  expect(store.connect).not.toHaveBeenCalled()
})

it.each(['kind', 'scopes', 'revision'])(
  'rechecks %s before confirming a connection',
  async (failure) => {
    administrator = true
    transport.mockImplementation(async () => new Response(JSON.stringify(tokenInfo)))
    const e = event('modal', 'setup', { fields: { getTextInputValue: () => 'candidate-secret' } })
    await send(e)
    if (failure === 'kind')
      transport.mockImplementation(
        async () => new Response(JSON.stringify({ ...tokenInfo, kind: 'personal' })),
      )
    if (failure === 'scopes')
      transport.mockImplementation(
        async () => new Response(JSON.stringify({ ...tokenInfo, scopes: [] })),
      )
    if (failure === 'revision') vi.mocked(store.connect).mockResolvedValue(false)
    const confirm = event('button', controlId(e))
    await send(confirm)
    expect(confirm.editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining(
          failure === 'kind'
            ? 'collection integration token'
            : failure === 'scopes'
              ? 'required scopes'
              : 'Settings changed',
        ),
      }),
    )
    if (failure !== 'revision') expect(store.connect).not.toHaveBeenCalled()
  },
)

it('does not treat pagination controls as settings confirmations', async () => {
  administrator = true
  const e = event('slash', 'list')
  await send(e)
  const forged = event('button', `confirm:${controlId(e).split(':')[1]}`)
  await send(forged)
  expect(forged.editReply).toHaveBeenCalledWith(
    expect.objectContaining({ content: 'Invalid control.' }),
  )
  expect(store.connect).not.toHaveBeenCalled()
  expect(store.policy).not.toHaveBeenCalled()
})

it('absorbs failures when Discord cannot deliver an error response', async () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {})
  const e = event('slash', 'random', {
    guildId: 'outside',
    editReply: vi.fn().mockRejectedValue(new Error('deleted interaction')),
  })
  await expect(send(e)).resolves.toBeUndefined()
  expect(log).toHaveBeenCalledWith('Could not deliver interaction error')
})

it.each(['missing-reference', 'inaccessible-reference', 'failed-reply'])(
  'handles message capture failure: %s',
  async (failure) => {
    const message = mentioningMessage(
      failure === 'missing-reference'
        ? { reference: null }
        : {
            fetchReference: vi.fn().mockRejectedValue(new Error('Unknown message')),
            ...(failure === 'failed-reply'
              ? { reply: vi.fn().mockRejectedValue(new Error('Missing access')) }
              : {}),
          },
    )
    await expect(bot.message(message as unknown as Message)).resolves.toBeUndefined()
    expect(message.reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining(
          failure === 'missing-reference' ? 'Reply to a message' : 'could not be found',
        ),
        allowedMentions: { parse: [], repliedUser: false },
      }),
    )
    expect(store.claim).not.toHaveBeenCalled()
  },
)

it('fetches its own membership when the cache is empty and supports thread replies', async () => {
  guild.members.me = null
  vi.spyOn(channel, 'isThread').mockReturnValue(true)
  const e = event('slash', 'random')
  await send(e)
  expect(guild.members.fetchMe).toHaveBeenCalled()
  expect(e.editReply).toHaveBeenCalledWith(expect.objectContaining({ embeds: expect.any(Array) }))
})

it.each([
  ['   ', 'Author', 'must not be empty'],
  ['Text', '   ', 'must not be empty'],
  ['x'.repeat(5001), 'Author', 'up to 5,000'],
  ['Text', 'x'.repeat(256), 'up to 5,000'],
])(
  'rejects invalid manual quote input before claiming a write: %s',
  async (text, author, error) => {
    const e = event('modal', 'create', {
      fields: {
        getTextInputValue: (name: string) =>
          name === 'date' ? '' : name === 'quote' ? text : author,
      },
    })
    await send(e)
    expect(e.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining(error) }),
    )
    expect(store.claim).not.toHaveBeenCalled()
    expect(transport).not.toHaveBeenCalled()
  },
)

it.each([
  { author: { bot: true, id: 'other-bot' } },
  { guildId: null },
  { guildId: 'outside' },
  { mentions: { users: new Map() } },
])('ignores messages that are not eligible capture requests: %j', async (overrides) => {
  const message = mentioningMessage(overrides)
  await bot.message(message as unknown as Message)
  expect(message.reply).not.toHaveBeenCalled()
  expect(store.get).not.toHaveBeenCalled()
  expect(transport).not.toHaveBeenCalled()
})
