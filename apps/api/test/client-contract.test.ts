import { createApiClient } from '@quotedb/shared'
import { expect, it } from 'vitest'
import { PASSWORD, type RequestOptions, setupTestApp } from './helpers'

const ctx = setupTestApp()

// Exercise the public client's serialization against the actual routes and database.
// Fastify injection replaces only the socket, while this jar models browser cookies.
function browserClient() {
  let cookie: string | undefined
  return createApiClient({
    baseUrl: 'http://api.test',
    fetch: async (input, init) => {
      const url = new URL(String(input))
      const response = await ctx.request({
        method: init?.method as RequestOptions['method'],
        url: `${url.pathname}${url.search}`,
        ...(cookie ? { cookie } : {}),
        ...(init?.body ? { payload: JSON.parse(String(init.body)) } : {}),
      })
      const session = response.cookies.find((item) => item.name === 'qdb_session')
      if (session) cookie = `qdb_session=${session.value}`
      return new Response(response.statusCode === 204 ? null : response.body, {
        status: response.statusCode,
        headers: { 'content-type': 'application/json' },
      })
    },
  })
}

it('supports a signed-in quote and personal token lifecycle through the shared client', async () => {
  const user = await ctx.createUser()
  const client = browserClient()
  expect(await client.auth.login({ email: user.email, password: PASSWORD })).toMatchObject({
    id: user.id,
  })
  expect(await client.me()).toMatchObject({ email: user.email })
  const quote = await client.quotes.create({ quote: 'A & B + C?', author: 'Ada' })
  expect(await client.quotes.get(quote.id)).toMatchObject({ quote: 'A & B + C?' })
  expect((await client.quotes.list({ q: 'A & B + C?' })).quotes.map((item) => item.id)).toContain(
    quote.id,
  )
  expect(await client.quotes.update(quote.id, { author: 'Grace' })).toMatchObject({
    author: 'Grace',
  })
  expect((await client.quotes.random()).quotes).toHaveLength(1)
  const token = await client.tokens.create({ name: 'Client contract', scopes: ['quotes:read'] })
  expect((await client.tokens.list()).tokens.map((item) => item.id)).toContain(token.id)
  await client.tokens.revoke(token.id)
  expect((await client.tokens.list()).tokens.map((item) => item.id)).not.toContain(token.id)
  await client.quotes.remove(quote.id)
  await expect(client.quotes.get(quote.id)).rejects.toMatchObject({ status: 404 })
  expect((await client.auth.sessions()).sessions).toHaveLength(1)
  await client.auth.logoutOthers()
  await client.auth.logout()
  await expect(client.me()).rejects.toMatchObject({ status: 401 })
})

it('supports administrator edits, soft deletion and restoration without exposing admin routes to users', async () => {
  const admin = await ctx.createUser({ role: 'ADMIN' })
  const client = browserClient()
  await client.auth.login({ email: admin.email, password: PASSWORD })
  const user = await client.admin.users.create({
    email: 'contract@example.test',
    name: 'Invited user',
  })
  expect(await client.admin.users.get(user.id)).toMatchObject({ password_set: false })
  expect(await client.admin.users.update(user.id, { name: 'Renamed user' })).toMatchObject({
    name: 'Renamed user',
  })
  expect((await client.admin.users.list({ q: 'Renamed' })).users.map((item) => item.id)).toContain(
    user.id,
  )
  await client.admin.users.sendPasswordReset(user.id)
  expect(ctx.mailer.outbox.some((message) => message.to === user.email)).toBe(true)
  const quote = await client.admin.quotes.create({
    user_id: user.id,
    quote: 'Admin quote',
    author: 'Ada',
  })
  expect(await client.admin.quotes.get(quote.id)).toMatchObject({ quote: 'Admin quote' })
  await client.admin.quotes.update(quote.id, { quote: 'Corrected quote' })
  expect((await client.admin.users.quotes(user.id)).quotes.map((item) => item.id)).toContain(
    quote.id,
  )
  await client.admin.quotes.remove(quote.id)
  expect(
    (await client.admin.quotes.list({ status: 'deleted' })).quotes.map((item) => item.id),
  ).toContain(quote.id)
  expect(await client.admin.quotes.restore(quote.id)).toMatchObject({ deleted_at: null })
  await client.admin.users.remove(user.id)
  expect(await client.admin.users.get(user.id)).toMatchObject({ deleted_at: expect.any(String) })
  expect(await client.admin.users.restore(user.id)).toMatchObject({ deleted_at: null })
  expect((await client.admin.stats()).users.total).toBeGreaterThanOrEqual(2)
  const regular = await ctx.createUser()
  const unauthorized = browserClient()
  await unauthorized.auth.login({ email: regular.email, password: PASSWORD })
  await expect(unauthorized.admin.users.list()).rejects.toMatchObject({ status: 403 })
})

it('creates shared collections and scoped tokens, and transfers ownership through the client', async () => {
  const owner = await ctx.createUser()
  const member = await ctx.createUser()
  const client = browserClient()
  await client.auth.login({ email: owner.email, password: PASSWORD })
  const collection = await client.collections.create({ name: 'Team quotes' })
  expect(await client.collections.update(collection.id, { name: 'Renamed team' })).toMatchObject({
    name: 'Renamed team',
  })
  expect((await client.collections.list()).collections.map((item) => item.id)).toContain(
    collection.id,
  )
  await client.collections.setMember(collection.id, { email: member.email, role: 'admin' })
  expect((await client.collections.members(collection.id)).members).toEqual(
    expect.arrayContaining([expect.objectContaining({ user_id: member.id, role: 'admin' })]),
  )
  const token = await client.collections.createToken(collection.id, {
    name: 'Integration',
    scopes: ['quotes:read'],
  })
  expect(token.collection_id).toBe(collection.id)
  expect((await client.collections.tokens(collection.id)).tokens.map((item) => item.id)).toContain(
    token.id,
  )
  await client.collections.revokeToken(collection.id, token.id)
  expect(
    (await client.collections.tokens(collection.id)).tokens.map((item) => item.id),
  ).not.toContain(token.id)
  await client.collections.transfer(collection.id, member.id)
  expect((await client.collections.members(collection.id)).members).toEqual(
    expect.arrayContaining([expect.objectContaining({ user_id: member.id, role: 'owner' })]),
  )
})
