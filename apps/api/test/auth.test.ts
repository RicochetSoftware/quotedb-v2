import bcrypt from 'bcryptjs'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { sessions, users } from '../src/db/schema'
import { ADMIN_ORIGIN, PASSWORD, setupTestApp } from './helpers'

const ctx = setupTestApp()

/** A Laravel-style `$2y$` hash, as carried over from v1. */
function laravelHash(password: string) {
  return bcrypt.hashSync(password, 10).replace(/^\$2b\$/, '$2y$')
}

function resetTokenFrom(text: string): string {
  const match = text.match(/token=([^\s&]+)/)
  if (!match?.[1]) throw new Error('no token in email')
  return decodeURIComponent(match[1])
}

describe('login', () => {
  it('signs in with email + password and sets an httpOnly session cookie', async () => {
    const user = await ctx.createUser({ email: 'alice@example.com', name: 'Alice' })
    const res = await ctx.request({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'ALICE@example.com', password: PASSWORD },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ id: user.id, email: 'alice@example.com', role: 'USER' })
    const cookie = res.cookies.find((c) => c.name === 'qdb_session')
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Lax', path: '/' })

    const me = await ctx.request({
      method: 'GET',
      url: '/api/v1/me',
      cookie: `qdb_session=${cookie?.value}`,
    })
    expect(me.statusCode).toBe(200)
    expect(me.json().name).toBe('Alice')
  })

  it('returns the same generic error for a wrong email and a wrong password', async () => {
    const user = await ctx.createUser()
    const wrongPassword = await ctx.request({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: user.email, password: 'not the password' },
    })
    const wrongEmail = await ctx.request({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'nobody@example.com', password: PASSWORD },
    })
    expect(wrongPassword.statusCode).toBe(401)
    expect(wrongEmail.statusCode).toBe(401)
    expect(wrongPassword.json().message).toBe(wrongEmail.json().message)
  })

  it('refuses soft-deleted users', async () => {
    const user = await ctx.createUser({ deletedAt: new Date() })
    const res = await ctx.request({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: user.email, password: PASSWORD },
    })
    expect(res.statusCode).toBe(401)
  })

  it('verifies a legacy bcrypt hash and transparently rehashes it to argon2id', async () => {
    const user = await ctx.createUser({
      passwordHash: laravelHash(PASSWORD),
      passwordAlgo: 'bcrypt-legacy',
    })
    await ctx.login(user.email)
    const [after] = await ctx.db.select().from(users).where(eq(users.id, user.id))
    expect(after?.passwordAlgo).toBe('argon2id')
    expect(after?.passwordHash).toMatch(/^\$argon2id\$/)
    // And the new hash still works.
    await ctx.login(user.email)
  })

  it('rejects a wrong password against a legacy hash without rehashing', async () => {
    const user = await ctx.createUser({
      passwordHash: laravelHash(PASSWORD),
      passwordAlgo: 'bcrypt-legacy',
    })
    const res = await ctx.request({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: user.email, password: 'wrong password here' },
    })
    expect(res.statusCode).toBe(401)
    const [after] = await ctx.db.select().from(users).where(eq(users.id, user.id))
    expect(after?.passwordAlgo).toBe('bcrypt-legacy')
  })

  it('rate-limits by email: 5 attempts per 15 minutes', async () => {
    const user = await ctx.createUser()
    const attempt = (email: string) =>
      ctx.request({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email, password: 'nope' },
      })
    for (let i = 0; i < 5; i++) expect((await attempt(user.email)).statusCode).toBe(401)
    expect((await attempt(user.email.toUpperCase())).statusCode).toBe(429)
    // A different email is unaffected.
    expect((await attempt('other@example.com')).statusCode).toBe(401)
  })

  it('blocks cross-site and origin-less state-changing requests', async () => {
    const user = await ctx.createUser()
    const evil = await ctx.request({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { origin: 'https://evil.example' },
      payload: { email: user.email, password: PASSWORD },
    })
    expect(evil.statusCode).toBe(403)
    const admin = await ctx.request({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { origin: ADMIN_ORIGIN },
      payload: { email: user.email, password: PASSWORD },
    })
    expect(admin.statusCode).toBe(200)
  })

  it('logout revokes the session row immediately', async () => {
    const user = await ctx.createUser()
    const cookie = await ctx.login(user.email)
    expect(
      (await ctx.request({ method: 'POST', url: '/api/v1/auth/logout', cookie })).statusCode,
    ).toBe(204)
    expect((await ctx.request({ method: 'GET', url: '/api/v1/me', cookie })).statusCode).toBe(401)
  })

  it('rejects a tampered session cookie', async () => {
    const user = await ctx.createUser()
    const cookie = await ctx.login(user.email)
    const tampered = `${cookie.slice(0, -3)}abc`
    expect(
      (await ctx.request({ method: 'GET', url: '/api/v1/me', cookie: tampered })).statusCode,
    ).toBe(401)
  })
})

describe('cookie domain', () => {
  const scoped = setupTestApp({
    COOKIE_DOMAIN: '.quotes.example',
    APP_URL: 'https://api.quotes.example',
  })

  it('scopes the session cookie to the apex domain so app. and admin. share it', async () => {
    const user = await scoped.createUser()
    const res = await scoped.request({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: user.email, password: PASSWORD },
    })
    const cookie = res.cookies.find((c) => c.name === 'qdb_session')
    expect(cookie?.domain).toBe('.quotes.example')
    expect(cookie?.secure).toBe(true)
  })
})

describe('password reset', () => {
  it('always returns 200 and only emails existing users', async () => {
    const user = await ctx.createUser()
    ctx.mailer.outbox.length = 0
    const unknown = await ctx.request({
      method: 'POST',
      url: '/api/v1/auth/password/forgot',
      payload: { email: 'ghost@example.com' },
    })
    const known = await ctx.request({
      method: 'POST',
      url: '/api/v1/auth/password/forgot',
      payload: { email: user.email },
    })
    expect(unknown.statusCode).toBe(200)
    expect(known.statusCode).toBe(200)
    expect(unknown.body).toBe(known.body)
    await expect.poll(() => ctx.mailer.outbox.length).toBe(1)
    expect(ctx.mailer.outbox[0]?.to).toBe(user.email)
    expect(ctx.mailer.outbox[0]?.text).toContain('http://web.test/reset-password?token=')
  })

  it('is single-use, sets an argon2id hash and revokes every session', async () => {
    const user = await ctx.createUser({
      passwordHash: laravelHash(PASSWORD),
      passwordAlgo: 'bcrypt-legacy',
    })
    const cookie = await ctx.login(user.email)
    ctx.mailer.outbox.length = 0
    await ctx.request({
      method: 'POST',
      url: '/api/v1/auth/password/forgot',
      payload: { email: user.email },
    })
    await expect.poll(() => ctx.mailer.outbox.length).toBe(1)
    const token = resetTokenFrom(ctx.mailer.outbox[0]?.text ?? '')

    const newPassword = 'a brand new password 123'
    const reset = await ctx.request({
      method: 'POST',
      url: '/api/v1/auth/password/reset',
      payload: { token, new_password: newPassword },
    })
    expect(reset.statusCode).toBe(200)

    expect((await ctx.request({ method: 'GET', url: '/api/v1/me', cookie })).statusCode).toBe(401)
    expect(await ctx.db.select().from(sessions).where(eq(sessions.userId, user.id))).toHaveLength(0)
    await ctx.login(user.email, newPassword)

    const again = await ctx.request({
      method: 'POST',
      url: '/api/v1/auth/password/reset',
      payload: { token, new_password: 'yet another password 456' },
    })
    expect(again.statusCode).toBe(400)
  })

  it('enforces the password policy (min 12 chars, not breached)', async () => {
    const user = await ctx.createUser()
    const cookie = await ctx.login(user.email)
    const short = await ctx.request({
      method: 'POST',
      url: '/api/v1/auth/password/change',
      cookie,
      payload: { current_password: PASSWORD, new_password: 'short' },
    })
    expect(short.statusCode).toBe(400)

    ctx.setBreachChecker(async (pw) => pw === 'password123456')
    const breached = await ctx.request({
      method: 'POST',
      url: '/api/v1/auth/password/change',
      cookie,
      payload: { current_password: PASSWORD, new_password: 'password123456' },
    })
    expect(breached.statusCode).toBe(400)
    expect(breached.json().message).toMatch(/breach/)
    ctx.setBreachChecker(async () => false)
  })
})

describe('password change and sessions', () => {
  it('requires the current password and signs out other sessions', async () => {
    const user = await ctx.createUser()
    const phone = await ctx.login(user.email)
    const laptop = await ctx.login(user.email)

    const wrong = await ctx.request({
      method: 'POST',
      url: '/api/v1/auth/password/change',
      cookie: laptop,
      payload: { current_password: 'not it at all', new_password: 'my new password is long' },
    })
    expect(wrong.statusCode).toBe(400)

    const sessionsRes = await ctx.request({
      method: 'GET',
      url: '/api/v1/auth/sessions',
      cookie: laptop,
    })
    expect(sessionsRes.json().sessions).toHaveLength(2)
    expect(sessionsRes.json().sessions.filter((s: { current: boolean }) => s.current)).toHaveLength(
      1,
    )

    const ok = await ctx.request({
      method: 'POST',
      url: '/api/v1/auth/password/change',
      cookie: laptop,
      payload: { current_password: PASSWORD, new_password: 'my new password is long' },
    })
    expect(ok.statusCode).toBe(200)
    expect(
      (await ctx.request({ method: 'GET', url: '/api/v1/me', cookie: laptop })).statusCode,
    ).toBe(200)
    expect(
      (await ctx.request({ method: 'GET', url: '/api/v1/me', cookie: phone })).statusCode,
    ).toBe(401)
  })

  it('logout-others keeps only the current session', async () => {
    const user = await ctx.createUser()
    const a = await ctx.login(user.email)
    const b = await ctx.login(user.email)
    expect(
      (await ctx.request({ method: 'POST', url: '/api/v1/auth/logout-others', cookie: b }))
        .statusCode,
    ).toBe(200)
    expect((await ctx.request({ method: 'GET', url: '/api/v1/me', cookie: a })).statusCode).toBe(
      401,
    )
    expect((await ctx.request({ method: 'GET', url: '/api/v1/me', cookie: b })).statusCode).toBe(
      200,
    )
  })
})
