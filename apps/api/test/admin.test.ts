import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { users } from '../src/db/schema'
import { ADMIN_ORIGIN, type RequestOptions, setupTestApp, userWithRole } from './helpers'

const ctx = setupTestApp()

const admin = (cookie: string, opts: Pick<RequestOptions, 'method' | 'url' | 'payload'>) =>
  ctx.request({ ...opts, cookie, headers: { origin: ADMIN_ORIGIN } })

describe('admin access', () => {
  it('is role-gated: USER → 403, anonymous → 401', async () => {
    const { cookie } = await userWithRole(ctx, 'USER')
    expect((await admin(cookie, { method: 'GET', url: '/api/v1/admin/users' })).statusCode).toBe(
      403,
    )
    expect((await ctx.request({ method: 'GET', url: '/api/v1/admin/users' })).statusCode).toBe(401)
  })
})

describe('admin users', () => {
  it('creates a user with an invite email, which sets their password', async () => {
    const { cookie } = await userWithRole(ctx, 'ADMIN')
    ctx.mailer.outbox.length = 0
    const res = await admin(cookie, {
      method: 'POST',
      url: '/api/v1/admin/users',
      payload: { email: 'New.Person@Example.com', name: 'New Person' },
    })
    expect(res.statusCode).toBe(201)
    expect(res.json()).toMatchObject({
      email: 'new.person@example.com',
      role: 'USER',
      password_set: false,
    })

    expect(ctx.mailer.outbox).toHaveLength(1)
    const token = decodeURIComponent(ctx.mailer.outbox[0]?.text.match(/token=([^\s&]+)/)?.[1] ?? '')
    const set = await ctx.request({
      method: 'POST',
      url: '/api/v1/auth/password/reset',
      payload: { token, new_password: 'my chosen password!' },
    })
    expect(set.statusCode).toBe(200)
    await ctx.login('new.person@example.com', 'my chosen password!')

    const dup = await admin(cookie, {
      method: 'POST',
      url: '/api/v1/admin/users',
      payload: { email: 'NEW.person@example.com', name: 'Dup' },
    })
    expect(dup.statusCode).toBe(409)
  })

  it('lists with search, role filter and soft-deleted filter', async () => {
    const { cookie } = await userWithRole(ctx, 'SUPER_ADMIN')
    await ctx.createUser({ name: 'Zelda Searchable', email: 'zelda@example.com' })
    const gone = await ctx.createUser({ name: 'Gone Person', deletedAt: new Date() })

    const search = await admin(cookie, { method: 'GET', url: '/api/v1/admin/users?q=zelda' })
    expect(search.json().users.map((u: { email: string }) => u.email)).toEqual([
      'zelda@example.com',
    ])

    const deleted = await admin(cookie, {
      method: 'GET',
      url: '/api/v1/admin/users?status=deleted',
    })
    expect(deleted.json().users.map((u: { id: string }) => u.id)).toContain(gone.id)

    const supers = await admin(cookie, {
      method: 'GET',
      url: '/api/v1/admin/users?role=SUPER_ADMIN',
    })
    expect(supers.json().users.every((u: { role: string }) => u.role === 'SUPER_ADMIN')).toBe(true)
  })

  it('soft-deletes (signing the user out) and restores', async () => {
    const { cookie } = await userWithRole(ctx, 'ADMIN')
    const victim = await userWithRole(ctx, 'USER')
    expect(
      (await admin(cookie, { method: 'DELETE', url: `/api/v1/admin/users/${victim.user.id}` }))
        .statusCode,
    ).toBe(204)
    expect(
      (await ctx.request({ method: 'GET', url: '/api/v1/me', cookie: victim.cookie })).statusCode,
    ).toBe(401)

    const restored = await admin(cookie, {
      method: 'POST',
      url: `/api/v1/admin/users/${victim.user.id}/restore`,
    })
    expect(restored.json().deleted_at).toBeNull()
    await ctx.login(victim.user.email)
  })

  it('enforces the role hierarchy', async () => {
    const adminUser = await userWithRole(ctx, 'ADMIN')
    const otherAdmin = await ctx.createUser({ role: 'ADMIN' })
    const plain = await ctx.createUser()

    const promoteSuper = await admin(adminUser.cookie, {
      method: 'PATCH',
      url: `/api/v1/admin/users/${plain.id}`,
      payload: { role: 'SUPER_ADMIN' },
    })
    expect(promoteSuper.statusCode).toBe(403)

    const editAdmin = await admin(adminUser.cookie, {
      method: 'PATCH',
      url: `/api/v1/admin/users/${otherAdmin.id}`,
      payload: { name: 'Renamed' },
    })
    expect(editAdmin.statusCode).toBe(403)

    const self = await admin(adminUser.cookie, {
      method: 'PATCH',
      url: `/api/v1/admin/users/${adminUser.user.id}`,
      payload: { role: 'USER' },
    })
    expect(self.statusCode).toBe(403)
    expect(
      (
        await admin(adminUser.cookie, {
          method: 'DELETE',
          url: `/api/v1/admin/users/${adminUser.user.id}`,
        })
      ).statusCode,
    ).toBe(403)

    const promote = await admin(adminUser.cookie, {
      method: 'PATCH',
      url: `/api/v1/admin/users/${plain.id}`,
      payload: { role: 'ADMIN', name: 'Promoted' },
    })
    expect(promote.statusCode).toBe(200)
    expect(promote.json()).toMatchObject({ role: 'ADMIN', name: 'Promoted' })

    const superAdmin = await userWithRole(ctx, 'SUPER_ADMIN')
    const demote = await admin(superAdmin.cookie, {
      method: 'PATCH',
      url: `/api/v1/admin/users/${otherAdmin.id}`,
      payload: { role: 'USER' },
    })
    expect(demote.statusCode).toBe(200)
  })

  it('sends a password reset email on request', async () => {
    const { cookie } = await userWithRole(ctx, 'ADMIN')
    const target = await ctx.createUser()
    ctx.mailer.outbox.length = 0
    const res = await admin(cookie, {
      method: 'POST',
      url: `/api/v1/admin/users/${target.id}/password-reset`,
    })
    expect(res.statusCode).toBe(200)
    expect(ctx.mailer.outbox[0]?.to).toBe(target.email)
  })
})

describe('admin quotes', () => {
  it('browses across users with filters, edits, soft-deletes and restores', async () => {
    const { cookie } = await userWithRole(ctx, 'ADMIN')
    const alice = await userWithRole(ctx, 'USER')
    const bob = await userWithRole(ctx, 'USER')
    const aq = await ctx.createQuote(alice.cookie, {
      quote: 'Alice says',
      author: 'Alice',
      date: '2025-03-10',
    })
    await ctx.createQuote(bob.cookie, { quote: 'Bob says', author: 'Bob', date: '2025-06-01' })

    const byUser = await admin(cookie, {
      method: 'GET',
      url: `/api/v1/admin/quotes?user_id=${alice.user.id}`,
    })
    expect(byUser.json()).toMatchObject({
      total: 1,
      quotes: [{ id: aq.id, user: { id: alice.user.id } }],
    })

    const byDate = await admin(cookie, {
      method: 'GET',
      url: '/api/v1/admin/quotes?from=2025-03-10&to=2025-03-10',
    })
    expect(byDate.json().quotes.map((q: { id: string }) => q.id)).toEqual([aq.id])

    const edited = await admin(cookie, {
      method: 'PATCH',
      url: `/api/v1/admin/quotes/${aq.id}`,
      payload: { quote: 'Edited' },
    })
    expect(edited.json().quote).toBe('Edited')

    expect(
      (await admin(cookie, { method: 'DELETE', url: `/api/v1/admin/quotes/${aq.id}` })).statusCode,
    ).toBe(204)
    expect(
      (await ctx.request({ method: 'GET', url: `/api/v1/quotes/${aq.id}`, cookie: alice.cookie }))
        .statusCode,
    ).toBe(404)
    const deleted = await admin(cookie, {
      method: 'GET',
      url: '/api/v1/admin/quotes?status=deleted',
    })
    expect(deleted.json().quotes.map((q: { id: string }) => q.id)).toContain(aq.id)

    const restored = await admin(cookie, {
      method: 'POST',
      url: `/api/v1/admin/quotes/${aq.id}/restore`,
    })
    expect(restored.json().deleted_at).toBeNull()

    const perUser = await admin(cookie, {
      method: 'GET',
      url: `/api/v1/admin/users/${alice.user.id}/quotes`,
    })
    expect(perUser.json().quotes).toHaveLength(1)
  })

  it('imports a quote for another user', async () => {
    const { cookie } = await userWithRole(ctx, 'ADMIN')
    const owner = await userWithRole(ctx, 'USER')
    const res = await admin(cookie, {
      method: 'POST',
      url: '/api/v1/admin/quotes',
      payload: { user_id: owner.user.id, quote: 'Imported', author: 'Someone', date: '2022-02-02' },
    })
    expect(res.statusCode).toBe(201)
    const own = await ctx.request({ method: 'GET', url: '/api/v1/quotes', cookie: owner.cookie })
    expect(own.json().quotes).toEqual([
      expect.objectContaining({ quote: 'Imported', date: '2022-02-02' }),
    ])
  })

  it('reports dashboard stats', async () => {
    const { cookie } = await userWithRole(ctx, 'ADMIN')
    const res = await admin(cookie, { method: 'GET', url: '/api/v1/admin/stats' })
    expect(res.statusCode).toBe(200)
    expect(res.json().users.total).toBeGreaterThan(0)
    expect(res.json().recent_quotes.length).toBeLessThanOrEqual(5)
    expect(await ctx.db.select().from(users).where(eq(users.role, 'ADMIN'))).not.toHaveLength(0)
  })
})
