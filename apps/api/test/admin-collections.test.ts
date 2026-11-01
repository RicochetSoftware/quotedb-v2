import { eq } from 'drizzle-orm'
import { expect, it } from 'vitest'
import { users } from '../src/db/schema'
import { setupTestApp, userWithRole } from './helpers'

const ctx = setupTestApp()
it('lets a site admin manage another user’s collection without joining it', async () => {
  const admin = await userWithRole(ctx, 'ADMIN')
  const owner = await userWithRole(ctx, 'USER')
  const target = await userWithRole(ctx, 'USER')
  const id = owner.user.id
  const url = `/api/v1/admin/collections/${id}`
  const call = (
    method: 'GET' | 'PATCH' | 'PUT' | 'POST' | 'DELETE',
    suffix = '',
    payload?: object,
  ) => ctx.request({ method, url: url + suffix, cookie: admin.cookie, payload })
  await ctx.createQuote(owner.cookie, { quote: 'Keep this quote' })
  expect((await call('GET')).statusCode).toBe(200)
  expect((await call('GET')).json().role).toBeUndefined()
  expect(
    (await call('PUT', '/members', { email: target.user.email, role: 'admin' })).statusCode,
  ).toBe(400)
  expect((await call('POST', '/transfer', { user_id: target.user.id })).statusCode).toBe(400)
  expect((await call('PATCH', '', { name: 'Shared memories', kind: 'shared' })).statusCode).toBe(
    200,
  )
  expect(
    (await call('PUT', '/members', { email: target.user.email, role: 'admin' })).statusCode,
  ).toBe(204)
  expect(
    (await call('PUT', '/members', { email: owner.user.email, role: 'viewer' })).statusCode,
  ).toBe(403)
  expect((await call('DELETE', `/members/${owner.user.id}`)).statusCode).toBe(403)
  expect((await call('POST', '/transfer', { user_id: target.user.id })).statusCode).toBe(204)
  const members = (await call('GET', '/members')).json().members
  expect(members).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ user_id: owner.user.id, role: 'admin' }),
      expect.objectContaining({ user_id: target.user.id, role: 'owner' }),
    ]),
  )
  expect(members.some((m: { user_id: string }) => m.user_id === admin.user.id)).toBe(false)
  expect((await call('POST', '/transfer', { user_id: target.user.id })).statusCode).toBe(204)
  expect(
    (await call('PUT', '/members', { email: owner.user.email, role: 'viewer' })).statusCode,
  ).toBe(204)
  expect((await call('DELETE', `/members/${owner.user.id}`)).statusCode).toBe(204)
  const quotes = await ctx.request({
    method: 'GET',
    url: `/api/v1/quotes?collection_id=${id}`,
    cookie: target.cookie,
  })
  expect(quotes.json().quotes[0].quote).toBe('Keep this quote')
  const personal = await ctx.request({ method: 'GET', url: '/api/v1/quotes', cookie: owner.cookie })
  expect(personal.json().quotes).toEqual([])
})
it('rejects ordinary users and tokens on every collection administration endpoint', async () => {
  const admin = await userWithRole(ctx, 'SUPER_ADMIN')
  const owner = await userWithRole(ctx, 'USER')
  const token = await ctx.createToken(admin.cookie, ['quotes:read', 'quotes:write'])
  const url = `/api/v1/admin/collections/${owner.user.id}`
  const operations = [
    { method: 'GET' as const, url },
    { method: 'GET' as const, url: `${url}/members` },
    { method: 'PATCH' as const, url, payload: { name: 'No' } },
    {
      method: 'PUT' as const,
      url: `${url}/members`,
      payload: { email: admin.user.email, role: 'admin' },
    },
    { method: 'DELETE' as const, url: `${url}/members/${owner.user.id}` },
    { method: 'POST' as const, url: `${url}/transfer`, payload: { user_id: admin.user.id } },
  ]
  for (const operation of operations) {
    expect((await ctx.request({ ...operation, cookie: owner.cookie })).statusCode).toBe(403)
    expect((await ctx.request({ ...operation, token: token.token })).statusCode).toBe(403)
  }
  expect((await ctx.request({ method: 'GET', url, cookie: admin.cookie })).statusCode).toBe(200)
  // Normal app routes remain membership-scoped, even for site admins.
  expect(
    (
      await ctx.request({
        method: 'PATCH',
        url: `/api/v1/collections/${owner.user.id}`,
        cookie: admin.cookie,
        payload: { name: 'No' },
      })
    ).statusCode,
  ).toBe(404)
})

it('hides collections owned by deleted users and restores visibility when the owner is restored', async () => {
  const admin = await userWithRole(ctx, 'ADMIN')
  const owner = await userWithRole(ctx, 'USER')
  const target = await userWithRole(ctx, 'USER')
  const url = `/api/v1/admin/collections/${owner.user.id}`
  await ctx.request({ method: 'PATCH', url, cookie: admin.cookie, payload: { kind: 'shared' } })
  await ctx.request({
    method: 'PUT',
    url: `${url}/members`,
    cookie: admin.cookie,
    payload: { email: target.user.email, role: 'member' },
  })
  const list = async (path: string, cookie: string) =>
    (await ctx.request({ method: 'GET', url: `/api/v1/${path}`, cookie })).json().collections as {
      id: string
    }[]
  await ctx.db.update(users).set({ deletedAt: new Date() }).where(eq(users.id, owner.user.id))
  expect((await list('admin/collections', admin.cookie)).some((c) => c.id === owner.user.id)).toBe(
    false,
  )
  expect((await list('collections', target.cookie)).some((c) => c.id === owner.user.id)).toBe(false)
  await ctx.db.update(users).set({ deletedAt: null }).where(eq(users.id, owner.user.id))
  expect((await list('admin/collections', admin.cookie)).some((c) => c.id === owner.user.id)).toBe(
    true,
  )
  await ctx.request({
    method: 'POST',
    url: `${url}/transfer`,
    cookie: admin.cookie,
    payload: { user_id: target.user.id },
  })
  await ctx.db.update(users).set({ deletedAt: new Date() }).where(eq(users.id, owner.user.id))
  // Transferred shared collections belong to the active new owner and remain visible.
  expect((await list('admin/collections', admin.cookie)).some((c) => c.id === owner.user.id)).toBe(
    true,
  )
  const personal = await userWithRole(ctx, 'USER')
  await ctx.db.update(users).set({ deletedAt: new Date() }).where(eq(users.id, personal.user.id))
  expect(
    (await list('admin/collections', admin.cookie)).some((c) => c.id === personal.user.id),
  ).toBe(false)
})
