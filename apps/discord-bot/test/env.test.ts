import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readEnv, required } from '../src/env.js'

beforeEach(() => {
  for (const [name, value] of Object.entries({
    BOT_ENCRYPTION_KEY: 'AB'.repeat(32),
    DISCORD_GUILD_IDS: '1313595711220224020,409042647416569866',
    QUOTEDB_API_URL: 'https://api.example.test/',
    QUOTEDB_PUBLIC_URL: 'https://quotes.example.test',
    DISCORD_BOT_TOKEN: ' test-token ',
    BOT_DATABASE_URL: 'postgres://localhost/bot',
  }))
    vi.stubEnv(name, value)
})
afterEach(() => vi.unstubAllEnvs())

describe('bot environment validation', () => {
  it('normalizes URLs, trims credentials, and decodes the encryption key', () => {
    expect(readEnv()).toEqual({
      token: 'test-token',
      guildIds: ['1313595711220224020', '409042647416569866'],
      key: Buffer.alloc(32, 0xab),
      databaseUrl: 'postgres://localhost/bot',
      apiUrl: 'https://api.example.test',
      publicUrl: 'https://quotes.example.test/',
    })
  })
  it.each(['', ' ', 'aa', 'ab'.repeat(31), 'ab'.repeat(33), `${'ab'.repeat(32)}zz`])(
    'rejects an invalid key without exposing it',
    (key) => {
      vi.stubEnv('BOT_ENCRYPTION_KEY', key)
      expect(() => readEnv()).toThrow(/BOT_ENCRYPTION_KEY/)
    },
  )
  it.each(['QUOTEDB_API_URL', 'QUOTEDB_PUBLIC_URL'])('rejects unsafe %s', (name) => {
    for (const url of [
      'file:///etc/passwd',
      'ftp://example.test',
      'https://user:secret@example.test',
    ]) {
      vi.stubEnv(name, url)
      expect(() => readEnv()).toThrow('QuoteDB URLs must be HTTP(S) URLs without credentials')
    }
  })
  it('rejects missing and whitespace-only required values', () => {
    vi.stubEnv('DISCORD_BOT_TOKEN', undefined)
    expect(() => required('DISCORD_BOT_TOKEN')).toThrow('DISCORD_BOT_TOKEN is required')
    vi.stubEnv('DISCORD_BOT_TOKEN', '  ')
    expect(() => readEnv()).toThrow('DISCORD_BOT_TOKEN is required')
  })
})
