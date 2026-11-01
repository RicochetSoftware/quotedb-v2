import { createHmac, randomInt, randomUUID, timingSafeEqual } from 'node:crypto'
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'
import { CodeChallenge, Me, RequestCodeBody, VerifyCodeBody } from '@quotedb/shared'
import { and, eq, isNull, lt, sql } from 'drizzle-orm'
import { createSession, SESSION_COOKIE, sessionCookieOptions } from '../../auth/session'
import type { Db } from '../../db/client'
import { authBudgets, loginChallenges, users } from '../../db/schema'
import { loginCodeEmail } from '../../lib/emails'
import { toMe } from '../../lib/serialize'

type Transaction = Parameters<Parameters<Db['transaction']>[0]>[0]
const TTL = 10 * 60_000
const INVALID = 'Invalid or expired code. Request a new code if needed.'
export const normalizeEmail = (email: string) => email.trim().toLowerCase()

function digest(secret: string, value: string) {
  return createHmac('sha256', secret).update(value).digest('hex')
}

/** Committed even on denial: failed attempts and resends must consume their budgets. */
export async function consumeAuthBudget(
  db: Db,
  limits: { key: string; max: number; window: number }[],
) {
  return db.transaction(async (tx) => {
    let allowed = true
    for (const limit of [...limits].sort((a, b) => a.key.localeCompare(b.key))) {
      const now = new Date()
      const expired = sql`${authBudgets.startedAt} <= ${new Date(now.getTime() - limit.window).toISOString()}`
      const [row] = await tx
        .insert(authBudgets)
        .values({ key: limit.key, startedAt: now, count: 1 })
        .onConflictDoUpdate({
          target: authBudgets.key,
          set: {
            startedAt: sql`case when ${expired} then ${now.toISOString()}::timestamptz else ${authBudgets.startedAt} end`,
            count: sql`case when ${expired} then 1 else least(${authBudgets.count} + 1, 1000000) end`,
          },
        })
        .returning()
      if (!row || row.count > limit.max) allowed = false
    }
    return allowed
  })
}

async function lockEmail(tx: Transaction, email: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${email}, 0))`)
}

export const codeRoutes: FastifyPluginAsyncTypebox = async (app) => {
  const { db, env, mailer } = app.ctx
  const pending = new Set<Promise<void>>()
  app.addHook('onClose', async () => {
    await Promise.allSettled([...pending])
  })
  const emailKey = (email: string) => digest(env.AUTH_CODE_SECRET, email)

  app.post(
    '/auth/code/request',
    {
      schema: { tags: ['auth'], body: RequestCodeBody, response: { 200: CodeChallenge } },
    },
    async (request) => {
      const email = normalizeEmail(request.body.email)
      const key = emailKey(email)
      const allowed = await consumeAuthBudget(db, [
        { key: `send:cooldown:${key}`, max: 1, window: 60_000 },
        { key: `send:email:${key}`, max: 5, window: 60 * 60_000 },
        { key: `send:ip:${request.ip}`, max: 30, window: 60 * 60_000 },
        { key: 'send:global', max: env.AUTH_EMAIL_HOURLY_LIMIT, window: 60 * 60_000 },
      ])
      if (!allowed) throw app.httpErrors.tooManyRequests('Too many code requests. Try again later.')
      const id = randomUUID()
      const code = randomInt(0, 1_000_000).toString().padStart(6, '0')
      const user = await db.transaction(async (tx) => {
        await lockEmail(tx, email)
        const [user] = await tx
          .select()
          .from(users)
          .where(and(eq(users.email, email), isNull(users.deletedAt)))
          .for('update')
        await tx
          .update(loginChallenges)
          .set({ consumedAt: new Date() })
          .where(and(eq(loginChallenges.email, email), isNull(loginChallenges.consumedAt)))
        await tx.insert(loginChallenges).values({
          id,
          email,
          userId: user?.id ?? null,
          codeDigest: digest(env.AUTH_CODE_SECRET, `${id}:${code}`),
          expiresAt: new Date(Date.now() + TTL),
        })
        return user
      })
      // Do not wait on SMTP: unknown addresses and send failures have the same response.
      if (user) {
        const sending = mailer
          .send(loginCodeEmail(email, code))
          .catch(async () => {
            await db
              .update(loginChallenges)
              .set({ consumedAt: new Date() })
              .where(eq(loginChallenges.id, id))
            request.log.error(
              { audit: 'auth.code.delivery_failed', userId: user.id },
              'Code delivery failed',
            )
          })
          .catch(() => {
            request.log.error('Failed to invalidate undelivered code')
          })
        pending.add(sending)
        void sending.finally(() => pending.delete(sending))
      }
      // Bounded retention, including unknown-email challenges and IP budget keys.
      void Promise.all([
        db
          .delete(loginChallenges)
          .where(lt(loginChallenges.expiresAt, new Date(Date.now() - 86_400_000))),
        db.delete(authBudgets).where(lt(authBudgets.startedAt, new Date(Date.now() - 86_400_000))),
      ]).catch(() => request.log.warn('Auth cleanup failed'))
      return { challenge_id: id, expires_in: TTL / 1000, retry_after: 60 }
    },
  )

  app.post(
    '/auth/code/verify',
    {
      schema: { tags: ['auth'], body: VerifyCodeBody, response: { 200: Me } },
    },
    async (request, reply) => {
      const { challenge_id: id, code } = request.body
      const [challenge] = await db.select().from(loginChallenges).where(eq(loginChallenges.id, id))
      const allowed = await consumeAuthBudget(db, [
        { key: `verify:ip:${request.ip}`, max: 60, window: 60 * 60_000 },
        ...(challenge
          ? [{ key: `verify:email:${emailKey(challenge.email)}`, max: 20, window: 60 * 60_000 }]
          : []),
      ])
      if (!allowed)
        throw app.httpErrors.tooManyRequests('Too many verification attempts. Try again later.')
      if (!challenge) throw app.httpErrors.unauthorized(INVALID)
      const result = await db.transaction(async (tx) => {
        await lockEmail(tx, challenge.email)
        // Same user lock as administrative changes: email changes/deletion cannot race login.
        const [user] = challenge.userId
          ? await tx.select().from(users).where(eq(users.id, challenge.userId)).for('update')
          : []
        const [row] = await tx
          .select()
          .from(loginChallenges)
          .where(eq(loginChallenges.id, id))
          .for('update')
        if (!row || row.consumedAt || row.attempts >= 5 || row.expiresAt <= new Date()) return null
        await tx
          .update(loginChallenges)
          .set({ attempts: row.attempts + 1 })
          .where(eq(loginChallenges.id, id))
        const valid = timingSafeEqual(
          Buffer.from(row.codeDigest, 'hex'),
          Buffer.from(digest(env.AUTH_CODE_SECRET, `${id}:${code}`), 'hex'),
        )
        if (!valid || !user || user.deletedAt || normalizeEmail(user.email) !== row.email)
          return null
        await tx
          .update(loginChallenges)
          .set({ consumedAt: new Date() })
          .where(eq(loginChallenges.id, id))
        const session = await createSession(tx, user.id, {
          userAgent: request.headers['user-agent'],
          ip: request.ip,
        })
        return { user, ...session }
      })
      if (!result) throw app.httpErrors.unauthorized(INVALID)
      reply.setCookie(SESSION_COOKIE, result.token, sessionCookieOptions(env))
      request.log.info({ audit: 'auth.login', userId: result.user.id }, 'Signed in with email code')
      return toMe(result.user)
    },
  )
}
