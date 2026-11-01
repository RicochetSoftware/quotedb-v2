import { randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { commands } from '../src/commands/definitions.js'
import { readGuildIds } from '../src/env.js'
import { channelAllowed, creatorAllowed } from '../src/policies.js'
import { renderQuotes } from '../src/presentation/quotes.js'
import { decrypt, encrypt } from '../src/security/credentials.js'

describe('credential encryption', () => {
  it('uses unique nonces and binds ciphertext to the guild and key', () => {
    const key = randomBytes(32)
    const value = encrypt(key, 'guild-a', 'secret')
    expect(decrypt(key, 'guild-a', value)).toBe('secret')
    expect(encrypt(key, 'guild-a', 'secret')).not.toBe(value)
    expect(() => decrypt(key, 'guild-b', value)).toThrow()
    expect(() => decrypt(randomBytes(32), 'guild-a', value)).toThrow()
    expect(() => decrypt(key, 'guild-a', `${value.slice(0, -2)}xx`)).toThrow()
    expect(value).not.toContain('secret')
  })
})
it('keeps empty restrictions closed and supports thread parent policy', () => {
  expect(creatorAllowed({ mode: 'selected', ids: [] }, ['a'], false)).toBe(false)
  expect(creatorAllowed({ mode: 'selected', ids: [] }, [], true)).toBe(true)
  expect(creatorAllowed({ mode: 'selected', ids: ['a'] }, ['a'], false)).toBe(true)
  expect(channelAllowed({ mode: 'selected', ids: ['parent'] }, 'thread', 'parent')).toBe(true)
  expect(channelAllowed({ mode: 'selected', ids: [] }, 'channel')).toBe(false)
  expect(channelAllowed({ mode: 'all', ids: [] }, 'channel')).toBe(true)
})
it('renders bounded non-pinging previews and preserves complete text in an attachment', () => {
  const quotes = Array.from({ length: 5 }, () => ({
    quote: '*@everyone* '.repeat(400),
    author: '*Ada*',
    date: '2020-01-01',
  }))
  const result = renderQuotes(quotes, 'Quotes', 'https://quotes.example', 'Bot', 1)
  expect(result.embeds[0]?.data.description?.length).toBeLessThanOrEqual(4000)
  expect(result.allowedMentions.parse).toEqual([])
  expect(result.embeds[0]?.data.description).toContain('\\*')
  expect(result.files).toHaveLength(1)
  expect(String(result.files[0]?.attachment)).toContain(quotes[0]?.quote)
})
it('registers izaro independently from quote and includes message capture', () => {
  expect(commands.map((c) => c.name)).toEqual(['quote', 'izaro', 'Save quote'])
})

it('parses multiple configured servers and retains the single-server fallback', () => {
  expect(
    readGuildIds({
      DISCORD_GUILD_IDS: '1313595711220224020, 409042647416569866,1313595711220224020',
    }),
  ).toEqual(['1313595711220224020', '409042647416569866'])
  expect(readGuildIds({ DISCORD_GUILD_ID: '1313595711220224020' })).toEqual(['1313595711220224020'])
  expect(() => readGuildIds({ DISCORD_GUILD_IDS: '1313595711220224020,' })).toThrow()
  expect(() => readGuildIds({ DISCORD_GUILD_IDS: 'bad' })).toThrow()
  expect(() => readGuildIds({})).toThrow()
})
