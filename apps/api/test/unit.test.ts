import { describe, expect, it } from 'vitest'
import { formatToken, parseToken } from '../src/auth/api-token'
import { loadEnv } from '../src/env'
import { base62ToUuid, uuidToBase62 } from '../src/lib/crypto'
import { createHibpChecker } from '../src/lib/passwords'
import { likeContains, parseBackdate } from '../src/lib/serialize'

describe('token format', () => {
  it('round-trips UUIDs through base62', () => {
    for (const id of [crypto.randomUUID(), '00000000-0000-4000-8000-000000000000']) {
      expect(base62ToUuid(uuidToBase62(id))).toBe(id)
    }
  })

  it('parses only well-formed tokens', () => {
    const id = crypto.randomUUID()
    const token = formatToken('live', id, 'S'.repeat(43))
    expect(parseToken(token)).toEqual({ env: 'live', id, secret: 'S'.repeat(43) })
    expect(parseToken('qdb_prod_x_y')).toBeNull()
    expect(parseToken('qdb_live_abc')).toBeNull()
    expect(parseToken(`${token}_extra`)).toBeNull()
  })
})

describe('env', () => {
  it('applies defaults and coerces types', () => {
    const env = loadEnv({
      DATABASE_URL: 'postgres://x',
      COOKIE_SECRET: 'x'.repeat(32),
      PORT: '8080',
    })
    expect(env).toMatchObject({
      PORT: 8080,
      NODE_ENV: 'development',
      HIBP_ENABLED: true,
      TRUST_PROXY: false,
    })
  })

  it('fails loudly on missing or invalid values', () => {
    expect(() => loadEnv({ COOKIE_SECRET: 'short' })).toThrow(/DATABASE_URL|COOKIE_SECRET/)
  })
})

describe('HIBP check', () => {
  it('sends only the 5-char prefix and matches the suffix', async () => {
    // sha1("password") = 5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8
    let requested = ''
    const check = createHibpChecker({ warn: () => {} }, (async (url: string) => {
      requested = url
      return new Response(
        '1E4C9B93F3F0682250B6CF8331B7EE68FD8:3861493\r\n0000000000000000000000000000000000:0',
      )
    }) as unknown as typeof fetch)
    expect(await check('password')).toBe(true)
    expect(requested).toBe('https://api.pwnedpasswords.com/range/5BAA6')
  })

  it('fails open when the API is down', async () => {
    const check = createHibpChecker({ warn: () => {} }, (async () => {
      throw new Error('offline')
    }) as unknown as typeof fetch)
    expect(await check('password')).toBe(false)
  })
})

describe('helpers', () => {
  it('escapes LIKE wildcards', () => {
    expect(likeContains('50%_off\\')).toBe('%50\\%\\_off\\\\%')
  })

  it('parses backdates as UTC midnight', () => {
    expect(parseBackdate('2024-02-29').toISOString()).toBe('2024-02-29T00:00:00.000Z')
  })
})
