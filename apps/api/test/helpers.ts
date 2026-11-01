import { generateKeyPairSync, randomUUID } from 'node:crypto'
import type { Role, Scope } from '@quotedb/shared'
import { eq } from 'drizzle-orm'
import type { LightMyRequestResponse } from 'fastify'
import { SignJWT } from 'jose'
import postgres from 'postgres'
import { afterAll, beforeAll, inject } from 'vitest'
import { createSession } from '../src/auth/session'
import { createDb, type Db } from '../src/db/client'
import { users } from '../src/db/schema'
import { loadEnv } from '../src/env'
import { createMemoryMailer } from '../src/lib/mailer'
import { type App, buildApp } from '../src/server'

export const WEB_ORIGIN = 'http://web.test'
export const ADMIN_ORIGIN = 'http://admin.test'

export interface RequestOptions {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE' | 'PUT'
  url: string
  payload?: object
  headers?: Record<string, string | undefined>
  /** `qdb_session=…` as returned by `login()`. */
  cookie?: string
  /** A personal access token, sent as `Authorization: Bearer`. */
  token?: string
}

export interface TestContext {
  app: App
  db: Db
  mailer: ReturnType<typeof createMemoryMailer>
  /** `app.inject` that sends a same-site Origin by default (like a browser on the web app). */
  request(opts: RequestOptions): Promise<LightMyRequestResponse>
  createUser(overrides?: Partial<typeof users.$inferInsert>): Promise<typeof users.$inferSelect>
  login(email: string): Promise<string>
  adminAssertion(email: string, claims?: Record<string, unknown>): Promise<string>
  createToken(
    cookie: string,
    scopes: Scope[],
    extra?: Record<string, unknown>,
  ): Promise<{ id: string; token: string }>
  createQuote(cookie: string, body?: Record<string, unknown>): Promise<{ id: string }>
}

/** Fresh database + app per test file. Call at the top level of a test file. */
export function setupTestApp(envOverrides: Record<string, string> = {}): TestContext {
  const ctx = {} as TestContext
  const keys = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const adminIdentities = new Map<string, string>()
  let close: () => Promise<void>
  const dbName = `test_${randomUUID().replaceAll('-', '')}`

  beforeAll(async () => {
    const adminUrl = inject('pgAdminUrl')
    const admin = postgres(adminUrl, { max: 1, onnotice: () => {} })
    await admin.unsafe(`create database ${dbName} template ${inject('pgTemplate')}`)
    await admin.end()
    const url = new URL(adminUrl)
    url.pathname = `/${dbName}`

    const env = loadEnv({
      NODE_ENV: 'test',
      DATABASE_URL: url.toString(),
      COOKIE_SECRET: 'test-cookie-secret-that-is-at-least-32-chars',
      WEB_URL: WEB_ORIGIN,
      ADMIN_URL: ADMIN_ORIGIN,
      APP_URL: 'http://api.test',
      CF_ACCESS_AUD: 'test-admin',
      ADMIN_DEV_PUBLIC_KEY: keys.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      ...envOverrides,
    })
    const created = createDb(env.DATABASE_URL, { max: 5 })
    const mailer = createMemoryMailer()
    const app = await buildApp({
      env,
      db: created.db,
      mailer,
      logger: false,
    })
    await app.ready()
    close = async () => {
      await app.close()
      await created.close()
    }

    Object.assign(ctx, {
      app,
      db: created.db,
      mailer,
      async request({ cookie, token, headers, ...opts }) {
        // Domain tests use both credentials from the fixture. Auth-boundary tests explicitly
        // suppress this header or use app.inject to exercise cookie-only requests.
        const email = cookie && adminIdentities.get(cookie)
        const assertion =
          email && opts.url.startsWith('/api/v1/admin')
            ? await ctx.adminAssertion(email)
            : undefined
        const merged: Record<string, unknown> = {
          origin: opts.url.startsWith('/api/v1/admin') ? ADMIN_ORIGIN : WEB_ORIGIN,
          ...(assertion ? { 'cf-access-jwt-assertion': assertion } : {}),
          ...(cookie ? { cookie } : {}),
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          ...headers,
        }
        for (const key of Object.keys(merged)) if (merged[key] === undefined) delete merged[key]
        return app.inject({ ...opts, headers: merged as Record<string, string> })
      },
      async createUser(overrides = {}) {
        const [user] = await created.db
          .insert(users)
          .values({
            email: `user-${randomUUID().slice(0, 8)}@example.com`,
            name: 'Test User',
            ...overrides,
          })
          .returning()
        if (!user) throw new Error('failed to create user')
        return user
      },
      async adminAssertion(email, claims = {}) {
        return new SignJWT({ email })
          .setProtectedHeader({ alg: 'RS256' })
          .setIssuer(String(claims.iss ?? 'http://quotedb.local/access'))
          .setAudience(String(claims.aud ?? 'test-admin'))
          .setSubject(email)
          .setIssuedAt()
          .setExpirationTime((claims.exp as number | undefined) ?? '1h')
          .sign(keys.privateKey)
      },
      async login(email) {
        // Most domain tests need a session, not another OTP test or shared sending budget.
        const [user] = await created.db.select().from(users).where(eq(users.email, email))
        if (!user) throw new Error('Unknown fixture account')
        const { token } = await createSession(created.db, user.id, {
          userAgent: 'test',
          ip: '127.0.0.1',
        })
        const cookie = `qdb_session=${app.signCookie(token)}`
        adminIdentities.set(cookie, email)
        return cookie
      },
      async createToken(cookie, scopes, extra = {}) {
        const res = await ctx.request({
          method: 'POST',
          url: '/api/v1/tokens',
          cookie,
          payload: { name: 'test token', scopes, ...extra },
        })
        if (res.statusCode !== 201)
          throw new Error(`token create failed: ${res.statusCode} ${res.body}`)
        return res.json()
      },
      async createQuote(cookie, body = {}) {
        const res = await ctx.request({
          method: 'POST',
          url: '/api/v1/quotes',
          cookie,
          payload: { quote: 'To be or not to be', author: 'Hamlet', ...body },
        })
        if (res.statusCode !== 201)
          throw new Error(`quote create failed: ${res.statusCode} ${res.body}`)
        return res.json()
      },
    } satisfies Omit<TestContext, never>)
  })

  afterAll(async () => {
    await close?.()
  })

  return ctx
}

export async function userWithRole(ctx: TestContext, role: Role) {
  const user = await ctx.createUser({ role })
  return { user, cookie: await ctx.login(user.email) }
}
