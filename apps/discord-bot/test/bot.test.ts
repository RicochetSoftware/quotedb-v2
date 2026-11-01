import { randomBytes } from 'node:crypto'
import type { Client, Interaction, Message } from 'discord.js'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createBot } from '../src/bot.js'
import type { Settings, Store } from '../src/db/store.js'
import type { Env } from '../src/env.js'
import { encrypt } from '../src/security/credentials.js'

const env: Env = {
  token: 'discord-secret',
  guildId: '123',
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
  members: { fetch: vi.fn(async () => member), me: member },
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
