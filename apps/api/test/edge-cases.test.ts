import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import type { FastifyRequest } from 'fastify'
import { afterEach, expect, it, vi } from 'vitest'
import { collectionAccess } from '../src/modules/collections/access'
import { PASSWORD, setupTestApp, userWithRole, WEB_ORIGIN } from './helpers'

const ctx = setupTestApp()
afterEach(() => {
  vi.restoreAllMocks()
  ctx.setBreachChecker(async () => false)
})

it('accepts a same-site Referer but rejects missing and malformed CSRF provenance', async () => {
  const user = await ctx.createUser()
  for (const [referer, status] of [
    [`${WEB_ORIGIN}/login`, 200],
    [undefined, 403],
    ['not a URL', 403],
  ] as const) {
    const res = await ctx.request({
      method: 'POST',
      url: '/api/v1/auth/code/request',
      payload: { email: user.email },
      headers: { origin: undefined, referer },
    })
    expect(res.statusCode).toBe(status)
  }
})

it('keeps authentication available when session and token usage writes fail', async () => {
  const user = await ctx.createUser()
  const cookie = await ctx.login(user.email)
  const token = await ctx.createToken(cookie, ['quotes:read'])
  // A fresh login avoids the per-session bookkeeping debounce.
  const freshCookie = await ctx.login(user.email)
  await ctx.db.execute(
    sql`create function reject_usage_write() returns trigger language plpgsql as $$ begin raise exception 'usage write unavailable'; end $$`,
  )
  await ctx.db.execute(
    sql`create trigger reject_session_usage before update on sessions for each row execute function reject_usage_write()`,
  )
  await ctx.db.execute(
    sql`create trigger reject_token_usage before update on api_tokens for each row execute function reject_usage_write()`,
  )
  const warn = vi.spyOn(ctx.app.log, 'warn')
  try {
    expect(
      (await ctx.request({ method: 'GET', url: '/api/v1/me', cookie: freshCookie })).statusCode,
    ).toBe(200)
    expect(
      (await ctx.request({ method: 'GET', url: '/api/v1/quotes', token: token.token })).statusCode,
    ).toBe(200)
    await vi.waitFor(() => {
      expect(warn).toHaveBeenCalledWith(expect.any(Object), 'failed to touch session')
      expect(warn).toHaveBeenCalledWith(expect.any(Object), 'failed to touch api token')
    })
  } finally {
    await ctx.db.execute(sql`drop trigger reject_session_usage on sessions`)
    await ctx.db.execute(sql`drop trigger reject_token_usage on api_tokens`)
    await ctx.db.execute(sql`drop function reject_usage_write()`)
  }
})

it('does not disclose sign-in code mail delivery failures to the caller', async () => {
  const user = await ctx.createUser()
  vi.spyOn(ctx.mailer, 'send').mockRejectedValue(new Error('mail offline'))
  const warn = vi.spyOn(ctx.app.log, 'error')
  const res = await ctx.request({
    method: 'POST',
    url: '/api/v1/auth/code/request',
    payload: { email: user.email },
  })
  expect(res.statusCode).toBe(200)
  await vi.waitFor(() => expect(warn).toHaveBeenCalled())
})

it('enforces administrative account permissions and reports conflicting updates', async () => {
  const admin = await userWithRole(ctx, 'ADMIN')
  const target = await ctx.createUser()
  const other = await ctx.createUser()
  expect(
    (
      await ctx.request({
        method: 'PATCH',
        url: `/api/v1/admin/users/${admin.user.id}`,
        cookie: admin.cookie,
        payload: { name: 'New admin name' },
      })
    ).json(),
  ).toMatchObject({ name: 'New admin name' })
  expect(
    (
      await ctx.request({
        method: 'POST',
        url: '/api/v1/admin/users',
        cookie: admin.cookie,
        payload: {
          email: 'promoted@example.test',
          name: 'Promoted',
          role: 'SUPER_ADMIN',
        },
      })
    ).statusCode,
  ).toBe(403)
  ctx.setBreachChecker(async () => true)
  expect(
    (
      await ctx.request({
        method: 'POST',
        url: '/api/v1/admin/users',
        cookie: admin.cookie,
        payload: { email: 'breached@example.test', name: 'Breached', password: PASSWORD },
      })
    ).statusCode,
  ).toBe(400)
  expect(
    (
      await ctx.request({
        method: 'PATCH',
        url: `/api/v1/admin/users/${target.id}`,
        cookie: admin.cookie,
        payload: { email: other.email },
      })
    ).statusCode,
  ).toBe(409)
  expect(
    (
      await ctx.request({
        method: 'GET',
        url: '/api/v1/admin/users?status=all',
        cookie: admin.cookie,
      })
    ).statusCode,
  ).toBe(200)
})

it('returns internal errors for database write failures and remains usable afterward', async () => {
  const admin = await userWithRole(ctx, 'ADMIN')
  const target = await ctx.createUser()
  await ctx.db.execute(
    sql`create function reject_account_write() returns trigger language plpgsql as $$ begin if new.name = 'Rejected write' then raise exception 'account storage unavailable'; end if; return new; end $$`,
  )
  await ctx.db.execute(
    sql`create trigger reject_account_write before insert or update on users for each row execute function reject_account_write()`,
  )
  try {
    for (const [method, url, payload] of [
      ['POST', '/api/v1/admin/users', { email: 'failed@example.test', name: 'Rejected write' }],
      ['PATCH', `/api/v1/admin/users/${target.id}`, { name: 'Rejected write' }],
    ] as const) {
      const res = await ctx.request({ method, url, cookie: admin.cookie, payload })
      expect(res.statusCode).toBe(500)
      expect(res.body).not.toContain('account storage unavailable')
    }
  } finally {
    await ctx.db.execute(sql`drop trigger reject_account_write on users`)
    await ctx.db.execute(sql`drop function reject_account_write()`)
  }
  expect(
    (
      await ctx.request({
        method: 'PATCH',
        url: `/api/v1/admin/users/${target.id}`,
        cookie: admin.cookie,
        payload: { name: 'Recovered' },
      })
    ).json(),
  ).toMatchObject({ name: 'Recovered' })
})

it('protects shared collection ownership, membership, and integration administration', async () => {
  const owner = await ctx.createUser()
  const cookie = await ctx.login(owner.email)
  const res = await ctx.request({
    method: 'POST',
    url: '/api/v1/collections',
    cookie,
    payload: { name: 'Team' },
  })
  expect(res.statusCode).toBe(201)
  const { id } = res.json()
  const base = `/api/v1/collections/${id}`
  const admins = await Promise.all([ctx.createUser(), ctx.createUser()])
  for (const admin of admins)
    expect(
      (
        await ctx.request({
          method: 'PUT',
          url: `${base}/members`,
          cookie,
          payload: { email: admin.email, role: 'admin' },
        })
      ).statusCode,
    ).toBe(204)
  assert(admins[0] && admins[1])
  const adminCookie = await ctx.login(admins[0].email)
  expect(
    (await ctx.request({ method: 'PATCH', url: base, cookie, payload: { name: '   ' } }))
      .statusCode,
  ).toBe(400)
  expect(
    (
      await ctx.request({
        method: 'PATCH',
        url: base,
        cookie: adminCookie,
        payload: { kind: 'shared' },
      })
    ).statusCode,
  ).toBe(403)
  expect(
    (
      await ctx.request({
        method: 'PUT',
        url: `${base}/members`,
        cookie,
        payload: { email: 'missing@example.test', role: 'member' },
      })
    ).statusCode,
  ).toBe(404)
  expect(
    (
      await ctx.request({
        method: 'DELETE',
        url: `${base}/members/${admins[1].id}`,
        cookie: adminCookie,
      })
    ).statusCode,
  ).toBe(403)
  expect(
    (
      await ctx.request({
        method: 'POST',
        url: `${base}/tokens`,
        cookie,
        payload: {
          name: 'Expired',
          scopes: ['quotes:read'],
          expires_at: '2020-01-01T00:00:00.000Z',
        },
      })
    ).statusCode,
  ).toBe(400)
  const siteAdmin = await userWithRole(ctx, 'ADMIN')
  expect(
    (
      await ctx.request({
        method: 'DELETE',
        url: `/api/v1/admin/users/${owner.id}`,
        cookie: siteAdmin.cookie,
      })
    ).statusCode,
  ).toBe(409)
  await expect(
    collectionAccess(
      {
        server: ctx.app,
        auth: {
          kind: 'token',
          tokenKind: 'collection',
          collectionId: id,
          user: null,
          tokenId: randomUUID(),
          prefix: 'test',
          scopes: ['*'],
        },
      } as unknown as FastifyRequest,
      id,
      'admin',
    ),
  ).rejects.toThrow('A signed-in collection administrator is required')
})

it('validates quote cursors and provenance, and permits admin collection transfers', async () => {
  const user = await ctx.createUser()
  const cookie = await ctx.login(user.email)
  for (const cursor of [[], ['2025-02-30T00:00:00.000000Z', randomUUID()]]) {
    const encoded = Buffer.from(JSON.stringify(cursor)).toString('base64url')
    expect(
      (await ctx.request({ method: 'GET', url: `/api/v1/quotes?cursor=${encoded}`, cookie }))
        .statusCode,
    ).toBe(400)
  }
  expect(
    (
      await ctx.request({
        method: 'POST',
        url: '/api/v1/quotes',
        cookie,
        payload: {
          quote: 'Text',
          author: 'Author',
          discord: { guild_id: '1313595711220224020', submitter_id: '1313595711220224021' },
        },
      })
    ).statusCode,
  ).toBe(403)
  const quote = await ctx.createQuote(cookie)
  const target = await ctx.request({
    method: 'POST',
    url: '/api/v1/collections',
    cookie,
    payload: { name: 'Target' },
  })
  const admin = await userWithRole(ctx, 'ADMIN')
  expect(
    (
      await ctx.request({
        method: 'PATCH',
        url: `/api/v1/admin/quotes/${quote.id}`,
        cookie: admin.cookie,
        payload: { collection_id: randomUUID() },
      })
    ).statusCode,
  ).toBe(404)
  expect(
    (
      await ctx.request({
        method: 'PATCH',
        url: `/api/v1/admin/quotes/${quote.id}`,
        cookie: admin.cookie,
        payload: { collection_id: target.json().id },
      })
    ).statusCode,
  ).toBe(200)
  const listed = await ctx.request({
    method: 'GET',
    url: `/api/v1/admin/quotes?q=Hamlet&collection_id=${target.json().id}`,
    cookie: admin.cookie,
  })
  expect(listed.statusCode).toBe(200)
  expect(listed.json().quotes.map((item: { id: string }) => item.id)).toEqual([quote.id])
})
