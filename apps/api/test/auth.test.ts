import { generateKeyPairSync, randomUUID } from 'node:crypto'
import { eq, like } from 'drizzle-orm'
import { SignJWT } from 'jose'
import { beforeEach, describe, expect, it } from 'vitest'
import { authBudgets, loginChallenges, sessions, users } from '../src/db/schema'
import { loadEnv } from '../src/env'
import { buildApp } from '../src/server'
import { ADMIN_ORIGIN, setupTestApp } from './helpers'

const ctx = setupTestApp()
beforeEach(async () => {
  await ctx.db.delete(authBudgets)
  ctx.mailer.outbox.length = 0
})
async function requestCode(email: string) {
  return ctx.request({ method: 'POST', url: '/api/v1/auth/code/request', payload: { email } })
}
function codeFor(email: string) {
  const code = ctx.mailer.outbox.findLast((mail) => mail.to === email)?.text.match(/\b\d{6}\b/)?.[0]
  if (!code) throw new Error('Missing sign-in email')
  return code
}
async function challenge(email: string) {
  const res = await requestCode(email)
  expect(res.statusCode).toBe(200)
  return { challenge_id: res.json().challenge_id as string, code: codeFor(email.toLowerCase()) }
}
const verify = (payload: { challenge_id: string; code: string }) =>
  ctx.request({ method: 'POST', url: '/api/v1/auth/code/verify', payload })
const cookieFrom = (res: Awaited<ReturnType<typeof verify>>) =>
  `qdb_session=${res.cookies.find((c) => c.name === 'qdb_session')?.value}`

describe('email-code authentication', () => {
  it('verifies an existing account without a password and creates an HttpOnly session', async () => {
    const user = await ctx.createUser({ email: 'alice@example.com', passwordHash: null })
    const details = await challenge('ALICE@example.com')
    const res = await verify(details)
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ id: user.id, email: user.email })
    expect(res.cookies[0]).toMatchObject({ httpOnly: true, sameSite: 'Lax', path: '/' })
    expect(
      (await ctx.request({ method: 'GET', url: '/api/v1/me', cookie: cookieFrom(res) })).statusCode,
    ).toBe(200)
    const [stored] = await ctx.db
      .select()
      .from(loginChallenges)
      .where(eq(loginChallenges.id, details.challenge_id))
    expect(stored?.codeDigest).not.toBe(details.code)
    expect(stored?.codeDigest).toHaveLength(64)
    expect(stored?.consumedAt).not.toBeNull()
    expect((await verify(details)).statusCode).toBe(401)
  })

  it('does not create users or email unknown/deleted accounts and returns the same shape', async () => {
    const deleted = await ctx.createUser({ deletedAt: new Date() })
    for (const email of ['unknown@example.com', deleted.email]) {
      const res = await requestCode(email)
      expect(res.statusCode).toBe(200)
      expect(res.json()).toMatchObject({
        challenge_id: expect.any(String),
        expires_in: 600,
        retry_after: 60,
      })
      expect(
        (await verify({ challenge_id: res.json().challenge_id, code: '000000' })).statusCode,
      ).toBe(401)
    }
    expect(ctx.mailer.outbox).toHaveLength(0)
    expect(
      await ctx.db.select().from(users).where(eq(users.email, 'unknown@example.com')),
    ).toHaveLength(0)
  })

  it('expires codes and permits at most five attempts', async () => {
    const user = await ctx.createUser()
    const details = await challenge(user.email)
    for (let i = 0; i < 5; i++) {
      expect(
        (await verify({ ...details, code: details.code === '000000' ? '000001' : '000000' }))
          .statusCode,
      ).toBe(401)
    }
    expect((await verify(details)).statusCode).toBe(401)
    await ctx.db.delete(authBudgets)
    const expired = await challenge(user.email)
    await ctx.db
      .update(loginChallenges)
      .set({ expiresAt: new Date(0) })
      .where(eq(loginChallenges.id, expired.challenge_id))
    expect((await verify(expired)).statusCode).toBe(401)
  })

  it('allows only one concurrent redemption', async () => {
    const user = await ctx.createUser()
    const details = await challenge(user.email)
    const results = await Promise.all([verify(details), verify(details)])
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 401])
    expect(await ctx.db.select().from(sessions).where(eq(sessions.userId, user.id))).toHaveLength(1)
  })

  it('enforces resend cooldown and invalidates the earlier code', async () => {
    const user = await ctx.createUser()
    const old = await challenge(user.email)
    expect((await requestCode(user.email)).statusCode).toBe(429)
    await ctx.db
      .update(authBudgets)
      .set({ startedAt: new Date(Date.now() - 61_000) })
      .where(like(authBudgets.key, 'send:cooldown:%'))
    const fresh = await challenge(user.email)
    expect((await verify(old)).statusCode).toBe(401)
    expect((await verify(fresh)).statusCode).toBe(200)
  })

  it('keeps account verification limits across challenges and refuses invalid input', async () => {
    const user = await ctx.createUser()
    const first = await challenge(user.email)
    await verify({ ...first, code: first.code === '000000' ? '000001' : '000000' })
    await ctx.db
      .update(authBudgets)
      .set({ count: 20 })
      .where(like(authBudgets.key, 'verify:email:%'))
    await ctx.db.delete(authBudgets).where(like(authBudgets.key, 'send:cooldown:%'))
    const second = await challenge(user.email)
    expect((await verify(second)).statusCode).toBe(429)
    expect((await verify({ challenge_id: randomUUID(), code: 'abcdef' })).statusCode).toBe(400)
  })

  it('enforces persistent IP and global sending budgets', async () => {
    await ctx.db
      .insert(authBudgets)
      .values({ key: 'send:global', count: 1000, startedAt: new Date() })
    expect((await requestCode('unknown@example.test')).statusCode).toBe(429)
    await ctx.db.delete(authBudgets)
    await ctx.db
      .insert(authBudgets)
      .values({ key: 'send:ip:127.0.0.1', count: 30, startedAt: new Date() })
    expect((await requestCode('other@example.test')).statusCode).toBe(429)
  })

  it('shares sending budgets with a second API instance', async () => {
    const user = await ctx.createUser()
    await challenge(user.email)
    const second = await buildApp({
      env: ctx.app.ctx.env,
      db: ctx.db,
      mailer: ctx.mailer,
      logger: false,
    })
    try {
      const res = await second.inject({
        method: 'POST',
        url: '/api/v1/auth/code/request',
        headers: { origin: 'http://web.test' },
        payload: { email: user.email },
      })
      expect(res.statusCode).toBe(429)
    } finally {
      await second.close()
    }
  })

  it('rejects deleted users even with an outstanding valid code', async () => {
    const user = await ctx.createUser()
    const details = await challenge(user.email)
    await ctx.db.update(users).set({ deletedAt: new Date() }).where(eq(users.id, user.id))
    expect((await verify(details)).statusCode).toBe(401)
  })

  it('disables every password endpoint', async () => {
    for (const path of ['login', 'password/forgot', 'password/reset', 'password/change']) {
      expect(
        (await ctx.request({ method: 'POST', url: `/api/v1/auth/${path}`, payload: {} }))
          .statusCode,
      ).toBe(404)
    }
  })

  it('keeps logout and session revocation working', async () => {
    const user = await ctx.createUser()
    const first = await ctx.login(user.email)
    const second = await ctx.login(user.email)
    const list = await ctx.request({ method: 'GET', url: '/api/v1/auth/sessions', cookie: first })
    expect(list.json().sessions).toHaveLength(2)
    await ctx.request({ method: 'POST', url: '/api/v1/auth/logout-others', cookie: first })
    expect(
      (await ctx.request({ method: 'GET', url: '/api/v1/me', cookie: second })).statusCode,
    ).toBe(401)
    await ctx.request({ method: 'POST', url: '/api/v1/auth/logout', cookie: first })
    expect(
      (await ctx.request({ method: 'GET', url: '/api/v1/me', cookie: first })).statusCode,
    ).toBe(401)
  })
})

describe('Cloudflare admin boundary', () => {
  it('rejects web sessions and bearer tokens even for a super admin', async () => {
    const user = await ctx.createUser({ role: 'SUPER_ADMIN' })
    const cookie = await ctx.login(user.email)
    const token = await ctx.createToken(cookie, ['quotes:read'])
    for (const headers of [{ cookie }, { authorization: `Bearer ${token.token}` }]) {
      expect(
        (await ctx.app.inject({ method: 'GET', url: '/api/v1/admin/me', headers })).statusCode,
      ).toBe(401)
    }
  })

  it('checks signature, issuer, audience and expiry', async () => {
    const user = await ctx.createUser({ role: 'ADMIN' })
    const valid = await ctx.adminAssertion(user.email)
    expect(
      (
        await ctx.app.inject({
          method: 'GET',
          url: '/api/v1/admin/me',
          headers: { 'cf-access-jwt-assertion': valid },
        })
      ).statusCode,
    ).toBe(200)
    const wrongKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey
    const forged = await new SignJWT({ email: user.email })
      .setProtectedHeader({ alg: 'RS256' })
      .setIssuer('http://quotedb.local/access')
      .setAudience('test-admin')
      .setSubject(user.id)
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(wrongKey)
    // Re-signing fixtures with overridden registered claims is provided by the helper below.
    for (const token of [
      forged,
      'not-a-token',
      await ctx.adminAssertion(user.email, { aud: 'another-app' }),
      await ctx.adminAssertion(user.email, { iss: 'https://attacker.test' }),
      await ctx.adminAssertion(user.email, { exp: 1 }),
    ]) {
      expect(
        (
          await ctx.app.inject({
            method: 'GET',
            url: '/api/v1/admin/me',
            headers: { 'cf-access-jwt-assertion': token },
          })
        ).statusCode,
      ).toBe(401)
    }
  })

  it('rechecks local roles/deletion on every request, independent of the web cookie', async () => {
    const user = await ctx.createUser({ role: 'ADMIN' })
    const other = await ctx.createUser()
    const token = await ctx.adminAssertion(user.email)
    const headers = { 'cf-access-jwt-assertion': token, cookie: await ctx.login(other.email) }
    expect(
      (await ctx.app.inject({ method: 'GET', url: '/api/v1/admin/me', headers })).json().id,
    ).toBe(user.id)
    await ctx.db.update(users).set({ role: 'USER' }).where(eq(users.id, user.id))
    expect(
      (await ctx.app.inject({ method: 'GET', url: '/api/v1/admin/me', headers })).statusCode,
    ).toBe(403)
    await ctx.db
      .update(users)
      .set({ role: 'ADMIN', deletedAt: new Date() })
      .where(eq(users.id, user.id))
    expect(
      (await ctx.app.inject({ method: 'GET', url: '/api/v1/admin/me', headers })).statusCode,
    ).toBe(403)
  })

  it('requires browser provenance even when an admin assertion arrives with a bearer header', async () => {
    const user = await ctx.createUser({ role: 'ADMIN' })
    expect(
      (
        await ctx.app.inject({
          method: 'POST',
          url: '/api/v1/admin/users',
          headers: {
            'cf-access-jwt-assertion': await ctx.adminAssertion(user.email),
            authorization: 'Bearer anything',
          },
          payload: { email: 'new@example.test', name: 'New' },
        })
      ).statusCode,
    ).toBe(403)
  })

  it('revokes challenges and sessions on an email change and notifies the previous address', async () => {
    const admin = await ctx.createUser({ role: 'ADMIN' })
    const user = await ctx.createUser()
    const details = await challenge(user.email)
    const cookie = await ctx.login(user.email)
    const res = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/users/${user.id}`,
      headers: {
        origin: ADMIN_ORIGIN,
        'cf-access-jwt-assertion': await ctx.adminAssertion(admin.email),
      },
      payload: { email: 'changed@example.test' },
    })
    expect(res.statusCode).toBe(200)
    expect((await verify(details)).statusCode).toBe(401)
    expect((await ctx.request({ method: 'GET', url: '/api/v1/me', cookie })).statusCode).toBe(401)
    expect(
      ctx.mailer.outbox.some((m) => m.to === user.email && m.subject.includes('changed')),
    ).toBe(true)
  })

  it('fails closed for missing production configuration and refuses dev keys in production', () => {
    const base = {
      NODE_ENV: 'production',
      DATABASE_URL: 'postgres://localhost/db',
      COOKIE_SECRET: 'a'.repeat(40),
    }
    expect(() => loadEnv(base)).toThrow('Production requires')
    expect(() =>
      loadEnv({
        ...base,
        CF_ACCESS_TEAM: 'team',
        CF_ACCESS_AUD: 'aud',
        AUTH_CODE_SECRET: 'b'.repeat(40),
        ADMIN_DEV_PUBLIC_KEY: 'key',
      }),
    ).toThrow('Production requires')
  })
})
