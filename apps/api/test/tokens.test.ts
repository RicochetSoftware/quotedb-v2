import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { parseToken } from '../src/auth/api-token'
import { apiTokens, users } from '../src/db/schema'
import { type RequestOptions, setupTestApp, userWithRole } from './helpers'

const ctx = setupTestApp()

/** Requests made by a script: bearer token, no browser Origin. */
const bearer = (token: string, opts: Pick<RequestOptions, 'method' | 'url' | 'payload'>) =>
  ctx.request({ ...opts, token, headers: { origin: undefined } })

describe('personal access tokens (MIGRATION.md §3.6)', () => {
  it('returns the full token once, in the documented format', async () => {
    const { cookie } = await userWithRole(ctx, 'USER')
    const created = await ctx.createToken(cookie, ['quotes:read'])
    expect(created.token).toMatch(/^qdb_test_[0-9A-Za-z]+_[0-9A-Za-z]+$/)
    expect(parseToken(created.token)?.id).toBe(created.id)

    const list = await ctx.request({ method: 'GET', url: '/api/v1/tokens', cookie })
    const listed = list.json().tokens[0]
    expect(listed).toMatchObject({ id: created.id, scopes: ['quotes:read'] })
    expect(listed.token).toBeUndefined()
    expect(created.token.startsWith(listed.prefix)).toBe(true)

    const [row] = await ctx.db.select().from(apiTokens).where(eq(apiTokens.id, created.id))
    expect(row?.tokenHash).not.toContain(created.token.split('_')[3])
  })

  it('quotes:read only → 403 on POST /quotes, 200 on GET /quotes', async () => {
    const { cookie } = await userWithRole(ctx, 'USER')
    const { token } = await ctx.createToken(cookie, ['quotes:read'])
    expect((await bearer(token, { method: 'GET', url: '/api/v1/quotes' })).statusCode).toBe(200)
    const write = await bearer(token, {
      method: 'POST',
      url: '/api/v1/quotes',
      payload: { quote: 'q', author: 'a' },
    })
    expect(write.statusCode).toBe(403)
    expect((await bearer(token, { method: 'GET', url: '/api/v1/me' })).statusCode).toBe(403)
  })

  it('quotes:write can create, and the quote always belongs to the caller', async () => {
    const { user, cookie } = await userWithRole(ctx, 'USER')
    const other = await ctx.createUser()
    const { token } = await ctx.createToken(cookie, ['quotes:read', 'quotes:write'])

    const sneaky = await bearer(token, {
      method: 'POST',
      url: '/api/v1/quotes',
      payload: { quote: 'q', author: 'a', user_id: other.id },
    })
    expect(sneaky.statusCode).toBe(400)

    const ok = await bearer(token, {
      method: 'POST',
      url: '/api/v1/quotes',
      payload: { quote: 'q', author: 'a' },
    })
    expect(ok.statusCode).toBe(201)
    const mine = await ctx.request({ method: 'GET', url: `/api/v1/quotes/${ok.json().id}`, cookie })
    expect(mine.statusCode).toBe(200)
    expect(user.id).toBeTruthy()
  })

  it('a token can never call /tokens or /admin/*, whatever its scopes', async () => {
    const { cookie } = await userWithRole(ctx, 'SUPER_ADMIN')
    const { token, id } = await ctx.createToken(cookie, [
      'quotes:read',
      'quotes:write',
      'profile:read',
    ])
    for (const [method, url] of [
      ['GET', '/api/v1/tokens'],
      ['POST', '/api/v1/tokens'],
      ['DELETE', `/api/v1/tokens/${id}`],
      ['GET', '/api/v1/admin/users'],
      ['GET', '/api/v1/admin/stats'],
      ['POST', '/api/v1/auth/password/change'],
    ] as const) {
      const res = await bearer(token, {
        method,
        url,
        ...(method === 'POST'
          ? {
              payload: url.includes('password')
                ? { current_password: 'x', new_password: 'yyyyyyyyyyyyyy' }
                : { name: 'x', scopes: ['quotes:read'] },
            }
          : {}),
      })
      expect(res.statusCode, `${method} ${url}`).toBe(
        url.includes('/admin/') ? 401 : url.includes('/password/') ? 404 : 403,
      )
    }
  })

  it('revoked token → 401 on the very next request', async () => {
    const { cookie } = await userWithRole(ctx, 'USER')
    const { token, id } = await ctx.createToken(cookie, ['quotes:read'])
    expect((await bearer(token, { method: 'GET', url: '/api/v1/quotes' })).statusCode).toBe(200)
    expect(
      (await ctx.request({ method: 'DELETE', url: `/api/v1/tokens/${id}`, cookie })).statusCode,
    ).toBe(204)
    expect((await bearer(token, { method: 'GET', url: '/api/v1/quotes' })).statusCode).toBe(401)
  })

  it('expired token → 401', async () => {
    const { cookie } = await userWithRole(ctx, 'USER')
    const { token, id } = await ctx.createToken(cookie, ['quotes:read'], {
      expires_at: new Date(Date.now() + 60_000).toISOString(),
    })
    expect((await bearer(token, { method: 'GET', url: '/api/v1/quotes' })).statusCode).toBe(200)
    await ctx.db
      .update(apiTokens)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(apiTokens.id, id))
    expect((await bearer(token, { method: 'GET', url: '/api/v1/quotes' })).statusCode).toBe(401)
  })

  it('rejects expires_at in the past at creation', async () => {
    const { cookie } = await userWithRole(ctx, 'USER')
    const res = await ctx.request({
      method: 'POST',
      url: '/api/v1/tokens',
      cookie,
      payload: { name: 'old', scopes: ['quotes:read'], expires_at: '2020-01-01T00:00:00Z' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('token of a soft-deleted user → 401', async () => {
    const { user, cookie } = await userWithRole(ctx, 'USER')
    const { token } = await ctx.createToken(cookie, ['quotes:read'])
    await ctx.db.update(users).set({ deletedAt: new Date() }).where(eq(users.id, user.id))
    expect((await bearer(token, { method: 'GET', url: '/api/v1/quotes' })).statusCode).toBe(401)
  })

  it('wrong secret → 401, malformed → 400, wrong environment → 401', async () => {
    const { cookie } = await userWithRole(ctx, 'USER')
    const { token } = await ctx.createToken(cookie, ['quotes:read'])
    const parts = token.split('_')
    const wrongSecret = [...parts.slice(0, 3), 'A'.repeat(40)].join('_')
    expect((await bearer(wrongSecret, { method: 'GET', url: '/api/v1/quotes' })).statusCode).toBe(
      401,
    )
    expect((await bearer('not-a-token', { method: 'GET', url: '/api/v1/quotes' })).statusCode).toBe(
      400,
    )
    const live = token.replace('qdb_test_', 'qdb_live_')
    expect((await bearer(live, { method: 'GET', url: '/api/v1/quotes' })).statusCode).toBe(401)
  })

  it("two users' tokens cannot read each other's quotes (404, not 403)", async () => {
    const alice = await userWithRole(ctx, 'USER')
    const bob = await userWithRole(ctx, 'USER')
    const quote = await ctx.createQuote(alice.cookie, { quote: "Alice's secret" })
    const { token } = await ctx.createToken(bob.cookie, ['quotes:read', 'quotes:write'])

    expect(
      (await bearer(token, { method: 'GET', url: `/api/v1/quotes/${quote.id}` })).statusCode,
    ).toBe(404)
    expect(
      (await bearer(token, { method: 'DELETE', url: `/api/v1/quotes/${quote.id}` })).statusCode,
    ).toBe(404)
    const list = await bearer(token, { method: 'GET', url: '/api/v1/quotes' })
    expect(list.json().quotes).toEqual([])
  })

  it("cannot revoke another user's token", async () => {
    const alice = await userWithRole(ctx, 'USER')
    const bob = await userWithRole(ctx, 'USER')
    const { id } = await ctx.createToken(alice.cookie, ['quotes:read'])
    expect(
      (await ctx.request({ method: 'DELETE', url: `/api/v1/tokens/${id}`, cookie: bob.cookie }))
        .statusCode,
    ).toBe(404)
  })

  it('records last_used_at', async () => {
    const { cookie } = await userWithRole(ctx, 'USER')
    const { token, id } = await ctx.createToken(cookie, ['quotes:read'])
    await bearer(token, { method: 'GET', url: '/api/v1/quotes' })
    await expect
      .poll(
        async () =>
          (await ctx.db.select().from(apiTokens).where(eq(apiTokens.id, id)))[0]?.lastUsedAt,
      )
      .toBeInstanceOf(Date)
  })

  it('rate-limits per token (100/min), not per user', async () => {
    const { cookie } = await userWithRole(ctx, 'USER')
    const a = await ctx.createToken(cookie, ['quotes:read'])
    const b = await ctx.createToken(cookie, ['quotes:read'])
    const statuses: number[] = []
    for (let i = 0; i < 101; i++) {
      statuses.push(
        (await bearer(a.token, { method: 'GET', url: '/api/v1/quotes/random' })).statusCode,
      )
    }
    expect(statuses.slice(0, 100).every((s) => s === 200)).toBe(true)
    expect(statuses[100]).toBe(429)
    expect(
      (await bearer(b.token, { method: 'GET', url: '/api/v1/quotes/random' })).statusCode,
    ).toBe(200)
  })
})
