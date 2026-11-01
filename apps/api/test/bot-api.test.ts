import { expect, it } from 'vitest'
import { setupTestApp } from './helpers'

const ctx = setupTestApp()
it('introspects only the current API token without requiring profile scope or exposing secrets', async () => {
  const user = await ctx.createUser()
  const cookie = await ctx.login(user.email)
  const token = await ctx.createToken(cookie, ['quotes:read', 'quotes:write'])
  const res = await ctx.request({ method: 'GET', url: '/api/v1/token-info', token: token.token })
  expect(res.statusCode).toBe(200)
  expect(res.json()).toEqual({
    owner: { id: user.id, name: user.name },
    kind: 'personal',
    collection: { id: user.id, name: `${user.name}'s quotes`, kind: 'personal' },
    prefix: expect.any(String),
    scopes: ['quotes:read', 'quotes:write'],
    expires_at: null,
  })
  expect(res.body).not.toContain(token.token)
  expect(res.body).not.toContain('tokenHash')
  expect(res.headers['cache-control']).toBe('no-store')
  expect((await ctx.request({ method: 'GET', url: '/api/v1/token-info', cookie })).statusCode).toBe(
    403,
  )
  expect((await ctx.request({ method: 'GET', url: '/api/v1/token-info' })).statusCode).toBe(401)
  await ctx.request({ method: 'DELETE', url: `/api/v1/tokens/${token.id}`, cookie })
  expect(
    (await ctx.request({ method: 'GET', url: '/api/v1/token-info', token: token.token }))
      .statusCode,
  ).toBe(401)
})
it('paginates tied timestamps with filters and never crosses account boundaries', async () => {
  const user = await ctx.createUser()
  const cookie = await ctx.login(user.email)
  const other = await ctx.createUser()
  const otherCookie = await ctx.login(other.email)
  const expected: string[] = []
  for (let i = 0; i < 7; i++)
    expected.push(
      (
        await ctx.createQuote(cookie, {
          quote: `needle ${i}`,
          author: 'Ada',
          date: '2020-01-01T00:00:00.123Z',
        })
      ).id,
    )
  await ctx.createQuote(cookie, { quote: 'not matching', author: 'Else' })
  await ctx.createQuote(otherCookie, { quote: 'needle other', author: 'Ada' })
  const url = '/api/v1/quotes?max=5&q=needle&author=ada'
  const first = (await ctx.request({ method: 'GET', url, cookie })).json()
  expect(first.quotes).toHaveLength(5)
  expect(first.next_cursor).toEqual(expect.any(String))
  const second = (
    await ctx.request({ method: 'GET', url: `${url}&cursor=${first.next_cursor}`, cookie })
  ).json()
  expect(second.quotes).toHaveLength(2)
  expect(second.next_cursor).toBeUndefined()
  expect([...first.quotes, ...second.quotes].map((q: { id: string }) => q.id)).toEqual(
    expected.sort().reverse(),
  )
  const isolated = (
    await ctx.request({
      method: 'GET',
      url: `${url}&cursor=${first.next_cursor}`,
      cookie: otherCookie,
    })
  ).json()
  expect(isolated.quotes).toEqual([])
  expect((await ctx.request({ method: 'GET', url: `${url}&cursor=bad`, cookie })).statusCode).toBe(
    400,
  )
})
it('preserves PostgreSQL microsecond precision across pages', async () => {
  const user = await ctx.createUser()
  const cookie = await ctx.login(user.email)
  // SQL defaults and imported dates can have greater precision than JavaScript dates.
  const { sql } = await import('drizzle-orm')
  await ctx.db.execute(sql`insert into quotes (user_id, collection_id, quote, author, created_at) values
    (${user.id}, ${user.id}, 'first', 'Ada', '2020-01-01T00:00:00.123456Z'),
    (${user.id}, ${user.id}, 'second', 'Ada', '2020-01-01T00:00:00.123455Z')`)
  const first = (await ctx.request({ method: 'GET', url: '/api/v1/quotes?max=1', cookie })).json()
  const second = (
    await ctx.request({
      method: 'GET',
      url: `/api/v1/quotes?max=1&cursor=${first.next_cursor}`,
      cookie,
    })
  ).json()
  expect(first.quotes[0].quote).toBe('first')
  expect(second.quotes[0].quote).toBe('second')
})
