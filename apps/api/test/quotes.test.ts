import { describe, expect, it } from 'vitest'
import { users } from '../src/db/schema'
import { setupTestApp, userWithRole } from './helpers'

const ctx = setupTestApp()

describe('quotes', () => {
  it('requires authentication', async () => {
    expect((await ctx.request({ method: 'GET', url: '/api/v1/quotes' })).statusCode).toBe(401)
  })

  it('creates, lists newest first, gets, updates and soft-deletes own quotes', async () => {
    const { cookie } = await userWithRole(ctx, 'USER')
    const older = await ctx.createQuote(cookie, {
      quote: 'Older',
      author: 'Ann',
      date: '2024-01-31',
    })
    const newer = await ctx.createQuote(cookie, { quote: 'Newer', author: 'Bob' })

    const list = await ctx.request({ method: 'GET', url: '/api/v1/quotes', cookie })
    expect(list.json().quotes.map((q: { id: string }) => q.id)).toEqual([newer.id, older.id])
    expect(list.json().quotes[1]).toMatchObject({
      quote: 'Older',
      author: 'Ann',
      date: '2024-01-31',
    })

    const patched = await ctx.request({
      method: 'PATCH',
      url: `/api/v1/quotes/${older.id}`,
      cookie,
      payload: { author: 'Anne' },
    })
    expect(patched.statusCode).toBe(200)
    expect(patched.json()).toMatchObject({ author: 'Anne', date: '2024-01-31' })

    expect(
      (await ctx.request({ method: 'DELETE', url: `/api/v1/quotes/${older.id}`, cookie }))
        .statusCode,
    ).toBe(204)
    expect(
      (await ctx.request({ method: 'GET', url: `/api/v1/quotes/${older.id}`, cookie })).statusCode,
    ).toBe(404)
    const after = await ctx.request({ method: 'GET', url: '/api/v1/quotes', cookie })
    expect(after.json().quotes).toHaveLength(1)
  })

  it('filters by author (case-insensitive) and free text, and caps with max', async () => {
    const { cookie } = await userWithRole(ctx, 'USER')
    await ctx.createQuote(cookie, { quote: 'I think therefore I am', author: 'Descartes' })
    await ctx.createQuote(cookie, { quote: '100% literal match', author: 'Percent' })
    await ctx.createQuote(cookie, { quote: 'Cogito', author: 'descartes' })

    const byAuthor = await ctx.request({
      method: 'GET',
      url: '/api/v1/quotes?author=DESCARTES',
      cookie,
    })
    expect(byAuthor.json().quotes).toHaveLength(2)

    const text = await ctx.request({ method: 'GET', url: '/api/v1/quotes?q=therefore', cookie })
    expect(text.json().quotes).toHaveLength(1)

    // LIKE wildcards are matched literally.
    const percent = await ctx.request({ method: 'GET', url: '/api/v1/quotes?q=%25', cookie })
    expect(percent.json().quotes).toHaveLength(1)

    const capped = await ctx.request({ method: 'GET', url: '/api/v1/quotes?max=1', cookie })
    expect(capped.json().quotes).toHaveLength(1)

    expect(
      (await ctx.request({ method: 'GET', url: '/api/v1/quotes?max=1001', cookie })).statusCode,
    ).toBe(400)
  })

  it('random returns own quotes only, and is never cached', async () => {
    const alice = await userWithRole(ctx, 'USER')
    const bob = await userWithRole(ctx, 'USER')
    await ctx.createQuote(alice.cookie, { quote: 'alice-1' })
    await ctx.createQuote(alice.cookie, { quote: 'alice-2' })
    await ctx.createQuote(bob.cookie, { quote: 'bob-1' })

    const res = await ctx.request({
      method: 'GET',
      url: '/api/v1/quotes/random?max=10',
      cookie: alice.cookie,
    })
    expect(res.headers['cache-control']).toBe('no-store')
    expect(
      res
        .json()
        .quotes.map((q: { quote: string }) => q.quote)
        .sort(),
    ).toEqual(['alice-1', 'alice-2'])

    const one = await ctx.request({
      method: 'GET',
      url: '/api/v1/quotes/random',
      cookie: bob.cookie,
    })
    expect(one.json().quotes).toEqual([expect.objectContaining({ quote: 'bob-1' })])
  })

  it('validates input', async () => {
    const { cookie } = await userWithRole(ctx, 'USER')
    for (const payload of [
      {},
      { quote: '', author: 'a' },
      { quote: 'q', author: 'a', date: 'last tuesday' },
    ]) {
      expect(
        (await ctx.request({ method: 'POST', url: '/api/v1/quotes', cookie, payload })).statusCode,
      ).toBe(400)
    }
    expect(
      (await ctx.request({ method: 'GET', url: '/api/v1/quotes/not-a-uuid', cookie })).statusCode,
    ).toBe(400)
  })
})

describe('v1 back-compat shim', () => {
  it('serves own quotes by UUID or legacy integer id, in the v1 shape', async () => {
    const user = await ctx.createUser({ externalId: 42 })
    const cookie = await ctx.login(user.email)
    await ctx.createQuote(cookie, { quote: 'Legacy', author: 'Old API', date: '2023-05-01' })
    const { token } = await ctx.createToken(cookie, ['quotes:read'])

    for (const id of ['42', user.id]) {
      const res = await ctx.request({
        method: 'GET',
        url: `/api/v1/quotes/search/user/${id}?max_quotes=5`,
        token,
        headers: { origin: undefined },
      })
      expect(res.statusCode).toBe(200)
      expect(res.json()).toEqual({
        quotes: [
          { id: expect.any(String), quote: 'Legacy', author: 'Old API', date: '2023-05-01' },
        ],
      })
    }
    const random = await ctx.request({
      method: 'GET',
      url: '/api/v1/quotes/random/user/42?max_quotes=1',
      token,
    })
    expect(random.json().quotes).toHaveLength(1)
  })

  it("returns 403 for anyone else's id, and requires max_quotes", async () => {
    const owner = await ctx.createUser({ externalId: 7 })
    const { cookie } = await userWithRole(ctx, 'USER')
    expect(
      (
        await ctx.request({
          method: 'GET',
          url: '/api/v1/quotes/search/user/7?max_quotes=5',
          cookie,
        })
      ).statusCode,
    ).toBe(403)
    expect(
      (
        await ctx.request({
          method: 'GET',
          url: `/api/v1/quotes/random/user/${owner.id}?max_quotes=5`,
          cookie,
        })
      ).statusCode,
    ).toBe(403)
    expect(
      (await ctx.request({ method: 'GET', url: '/api/v1/quotes/search/user/7', cookie }))
        .statusCode,
    ).toBe(400)
  })
})

describe('public /izaro', () => {
  const featured = setupTestApp({ IZARO_USER_ID: '2' })

  it('shows a random quote from the configured user without auth', async () => {
    const izaro = await featured.createUser({ externalId: 2, name: 'Izaro' })
    const cookie = await featured.login(izaro.email)
    await featured.createQuote(cookie, { quote: 'Kaixo', author: 'Izaro' })
    const res = await featured.request({ method: 'GET', url: '/api/v1/public/izaro' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ quote: 'Kaixo', author: 'Izaro', added_by: 'Izaro' })
    expect(res.json().id).toBeUndefined()
  })

  it('is 404 when not configured', async () => {
    expect((await ctx.request({ method: 'GET', url: '/api/v1/public/izaro' })).statusCode).toBe(404)
    expect(users).toBeDefined()
  })
})

describe('ops', () => {
  it('serves /healthz and the OpenAPI document', async () => {
    expect((await ctx.request({ method: 'GET', url: '/healthz' })).json()).toEqual({ ok: true })
    const spec = await ctx.request({ method: 'GET', url: '/api/documentation/json' })
    expect(spec.statusCode).toBe(200)
    expect(Object.keys(spec.json().paths)).toContain('/api/v1/quotes')
  })
})
