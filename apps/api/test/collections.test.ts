import { eq } from 'drizzle-orm'
import { expect, it } from 'vitest'
import { users } from '../src/db/schema'
import { setupTestApp } from './helpers'

const ctx = setupTestApp()
async function account() {
  const user = await ctx.createUser()
  return { ...user, cookie: await ctx.login(user.email) }
}
async function shared(cookie: string) {
  const res = await ctx.request({
    method: 'POST',
    url: '/api/v1/collections',
    cookie,
    payload: { name: 'Server quotes' },
  })
  expect(res.statusCode).toBe(201)
  return res.json().id as string
}
async function member(id: string, cookie: string, email: string, role: string) {
  return ctx.request({
    method: 'PUT',
    url: `/api/v1/collections/${id}/members`,
    cookie,
    payload: { email, role },
  })
}
async function integration(id: string, cookie: string, scopes = ['quotes:read', 'quotes:write']) {
  const res = await ctx.request({
    method: 'POST',
    url: `/api/v1/collections/${id}/tokens`,
    cookie,
    payload: { name: 'Discord', scopes },
  })
  expect(res.statusCode).toBe(201)
  return res.json() as { id: string; token: string }
}

it('creates personal collections and keeps shared quotes isolated across all quote operations', async () => {
  const owner = await account()
  const stranger = await account()
  const id = await shared(owner.cookie)
  const quote = await ctx.createQuote(owner.cookie, { collection_id: id })
  const personal = (
    await ctx.request({ method: 'GET', url: '/api/v1/quotes', cookie: owner.cookie })
  ).json()
  expect(personal.quotes).toEqual([])
  const visible = (
    await ctx.request({ method: 'GET', url: '/api/v1/collections', cookie: stranger.cookie })
  ).json()
  expect(visible.collections).toHaveLength(1)
  expect(visible.collections[0]).toMatchObject({ kind: 'personal', role: 'owner' })
  for (const url of [
    `/quotes?collection_id=${id}`,
    `/quotes/random?collection_id=${id}`,
    `/quotes/${quote.id}`,
    `/collections/${id}/members`,
  ]) {
    expect(
      (await ctx.request({ method: 'GET', url: `/api/v1${url}`, cookie: stranger.cookie }))
        .statusCode,
    ).toBe(404)
  }
  for (const method of ['PATCH', 'DELETE'] as const) {
    expect(
      (
        await ctx.request({
          method,
          url: `/api/v1/quotes/${quote.id}`,
          cookie: stranger.cookie,
          ...(method === 'PATCH' ? { payload: { author: 'Intruder' } } : {}),
        })
      ).statusCode,
    ).toBe(404)
  }
  expect(
    (
      await ctx.request({
        method: 'POST',
        url: '/api/v1/quotes',
        cookie: stranger.cookie,
        payload: { collection_id: id, quote: 'Intrusion', author: 'Intruder' },
      })
    ).statusCode,
  ).toBe(404)
})

it('enforces viewer/member/admin roles and applies membership removal immediately', async () => {
  const owner = await account()
  const guest = await account()
  const another = await account()
  const id = await shared(owner.cookie)
  const quote = await ctx.createQuote(owner.cookie, { collection_id: id })
  expect((await member(id, owner.cookie, guest.email, 'viewer')).statusCode).toBe(204)
  expect(
    (await ctx.request({ method: 'GET', url: `/api/v1/quotes/${quote.id}`, cookie: guest.cookie }))
      .statusCode,
  ).toBe(200)
  expect(
    (
      await ctx.request({
        method: 'PATCH',
        url: `/api/v1/quotes/${quote.id}`,
        cookie: guest.cookie,
        payload: { quote: 'Changed' },
      })
    ).statusCode,
  ).toBe(403)
  expect(
    (
      await ctx.request({
        method: 'DELETE',
        url: `/api/v1/quotes/${quote.id}`,
        cookie: guest.cookie,
      })
    ).statusCode,
  ).toBe(403)
  expect((await member(id, owner.cookie, guest.email, 'member')).statusCode).toBe(204)
  expect(
    (
      await ctx.request({
        method: 'PATCH',
        url: `/api/v1/quotes/${quote.id}`,
        cookie: guest.cookie,
        payload: { quote: 'Changed' },
      })
    ).statusCode,
  ).toBe(200)
  expect((await member(id, guest.cookie, another.email, 'viewer')).statusCode).toBe(403)
  expect((await member(id, owner.cookie, guest.email, 'admin')).statusCode).toBe(204)
  expect((await member(id, guest.cookie, another.email, 'admin')).statusCode).toBe(403)
  expect((await member(id, guest.cookie, owner.email, 'member')).statusCode).toBe(403)
  expect((await member(id, guest.cookie, another.email, 'viewer')).statusCode).toBe(204)
  expect(
    (
      await ctx.request({
        method: 'DELETE',
        url: `/api/v1/collections/${id}/members/${guest.id}`,
        cookie: owner.cookie,
      })
    ).statusCode,
  ).toBe(204)
  expect(
    (await ctx.request({ method: 'GET', url: `/api/v1/quotes/${quote.id}`, cookie: guest.cookie }))
      .statusCode,
  ).toBe(404)
})

it('preserves quotes and personal token bindings when converting a collection', async () => {
  const owner = await account()
  const quote = await ctx.createQuote(owner.cookie, { date: '2020-01-01T00:00:00.000Z' })
  const token = await ctx.createToken(owner.cookie, ['quotes:read', 'quotes:write'])
  expect(
    (
      await ctx.request({
        method: 'POST',
        url: `/api/v1/collections/${owner.id}/tokens`,
        cookie: owner.cookie,
        payload: { name: 'bad', scopes: ['quotes:read'] },
      })
    ).statusCode,
  ).toBe(400)
  const res = await ctx.request({
    method: 'PATCH',
    url: `/api/v1/collections/${owner.id}`,
    cookie: owner.cookie,
    payload: { kind: 'shared', name: 'Discord server' },
  })
  expect(res.statusCode).toBe(200)
  const listed = (
    await ctx.request({ method: 'GET', url: '/api/v1/collections', cookie: owner.cookie })
  ).json().collections
  expect(listed).toHaveLength(2)
  const personal = listed.find((c: { kind: string }) => c.kind === 'personal')
  expect(personal.id).not.toBe(owner.id)
  expect(
    (await ctx.request({ method: 'GET', url: '/api/v1/quotes', cookie: owner.cookie })).json()
      .quotes,
  ).toEqual([])
  const original = (
    await ctx.request({ method: 'GET', url: '/api/v1/quotes', token: token.token })
  ).json().quotes
  expect(original).toHaveLength(1)
  expect(original[0]).toMatchObject({
    id: quote.id,
    collection_id: owner.id,
    created_by_user_id: owner.id,
    date: '2020-01-01',
  })
  expect(
    (
      await ctx.request({
        method: 'GET',
        url: `/api/v1/quotes?collection_id=${personal.id}`,
        token: token.token,
      })
    ).statusCode,
  ).toBe(404)
  // Repeating conversion must not create another personal collection.
  await ctx.request({
    method: 'PATCH',
    url: `/api/v1/collections/${owner.id}`,
    cookie: owner.cookie,
    payload: { kind: 'shared' },
  })
  expect(
    (await ctx.request({ method: 'GET', url: '/api/v1/collections', cookie: owner.cookie })).json()
      .collections,
  ).toHaveLength(2)
})

it('pins integration credentials to a collection and survives issuer removal/deletion', async () => {
  const owner = await account()
  const successor = await account()
  const id = await shared(owner.cookie)
  const token = await integration(id, owner.cookie)
  await member(id, owner.cookie, successor.email, 'member')
  expect(
    (
      await ctx.request({
        method: 'POST',
        url: `/api/v1/collections/${id}/transfer`,
        cookie: owner.cookie,
        payload: { user_id: successor.id },
      })
    ).statusCode,
  ).toBe(204)
  expect(
    (
      await ctx.request({
        method: 'DELETE',
        url: `/api/v1/collections/${id}/members/${owner.id}`,
        cookie: successor.cookie,
      })
    ).statusCode,
  ).toBe(204)
  await ctx.db.update(users).set({ deletedAt: new Date() }).where(eq(users.id, owner.id))
  const info = await ctx.request({ method: 'GET', url: '/api/v1/token-info', token: token.token })
  expect(info.statusCode).toBe(200)
  expect(info.json()).toMatchObject({ kind: 'collection', collection: { id } })
  expect(info.json().owner).toBeUndefined()
  const saved = await ctx.request({
    method: 'POST',
    url: '/api/v1/quotes',
    token: token.token,
    payload: {
      quote: 'From Discord',
      author: 'Display name',
      discord: {
        guild_id: '1313595711220224020',
        submitter_id: '1313595711220224021',
        message_id: '1313595711220224022',
      },
    },
  })
  expect(saved.statusCode).toBe(201)
  expect(saved.json()).toMatchObject({
    collection_id: id,
    source: 'discord',
    created_by_user_id: null,
  })
  expect(
    (
      await ctx.request({
        method: 'GET',
        url: `/api/v1/quotes?collection_id=${successor.id}`,
        token: token.token,
      })
    ).statusCode,
  ).toBe(404)
  expect(
    (await ctx.request({ method: 'GET', url: '/api/v1/collections', token: token.token }))
      .statusCode,
  ).toBe(403)
  expect(
    (
      await ctx.request({
        method: 'POST',
        url: `/api/v1/collections/${id}/tokens`,
        token: token.token,
        payload: { name: 'Escalation', scopes: ['quotes:read'] },
      })
    ).statusCode,
  ).toBe(403)
  expect(
    (
      await ctx.request({
        method: 'DELETE',
        url: `/api/v1/collections/${id}/tokens/${token.id}`,
        cookie: successor.cookie,
      })
    ).statusCode,
  ).toBe(204)
  expect(
    (await ctx.request({ method: 'GET', url: '/api/v1/quotes', token: token.token })).statusCode,
  ).toBe(401)
})

it('enforces integration scopes and keeps ownership unique during competing transfers', async () => {
  const owner = await account()
  const first = await account()
  const second = await account()
  const id = await shared(owner.cookie)
  const readOnly = await integration(id, owner.cookie, ['quotes:read'])
  expect(
    (
      await ctx.request({
        method: 'POST',
        url: '/api/v1/quotes',
        token: readOnly.token,
        payload: { quote: 'Denied', author: 'Me' },
      })
    ).statusCode,
  ).toBe(403)
  expect(
    (
      await ctx.request({
        method: 'POST',
        url: `/api/v1/collections/${id}/tokens`,
        cookie: owner.cookie,
        payload: { name: 'Bad scope', scopes: ['profile:read'] },
      })
    ).statusCode,
  ).toBe(400)
  await member(id, owner.cookie, first.email, 'member')
  await member(id, owner.cookie, second.email, 'member')
  const transfers = await Promise.all(
    [first, second].map((u) =>
      ctx.request({
        method: 'POST',
        url: `/api/v1/collections/${id}/transfer`,
        cookie: owner.cookie,
        payload: { user_id: u.id },
      }),
    ),
  )
  expect(transfers.map((r) => r.statusCode).sort()).toEqual([204, 403])
  const members = (
    await ctx.request({
      method: 'GET',
      url: `/api/v1/collections/${id}/members`,
      cookie: owner.cookie,
    })
  ).json().members
  expect(members.filter((m: { role: string }) => m.role === 'owner')).toHaveLength(1)
})
