import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'
import {
  ChangePasswordBody,
  ForgotPasswordBody,
  LoginBody,
  Me,
  OkResponse,
  ResetPasswordBody,
  SessionList,
} from '@quotedb/shared'
import { and, desc, eq, gt, isNull, ne } from 'drizzle-orm'
import { authOf, requireScope, requireSession, userOf } from '../../auth/plugin'
import { createSession, SESSION_COOKIE, sessionCookieOptions } from '../../auth/session'
import { passwordResetTokens, sessions, users } from '../../db/schema'
import { sha256 } from '../../lib/crypto'
import { hashPassword, verifyPassword } from '../../lib/passwords'
import { toMe } from '../../lib/serialize'
import { issueResetToken } from './reset'

const INVALID_CREDENTIALS = 'Invalid email or password'

export const authRoutes: FastifyPluginAsyncTypebox = async (app) => {
  const { db, env, isBreached } = app.ctx

  async function assertNotBreached(password: string) {
    if (await isBreached(password)) {
      throw app.httpErrors.badRequest(
        'This password has appeared in a known data breach. Please choose a different one.',
      )
    }
  }

  app.post(
    '/auth/login',
    {
      schema: { tags: ['auth'], body: LoginBody, response: { 200: Me } },
      config: {
        rateLimit: {
          max: 5,
          timeWindow: '15 minutes',
          keyGenerator: (req) =>
            `login:${String((req.body as { email?: string })?.email).toLowerCase()}`,
          errorResponseBuilder: (_req, ctx) => ({
            statusCode: 429,
            error: 'Too Many Requests',
            message: `Too many sign-in attempts. Try again in ${ctx.after}.`,
          }),
        },
      },
    },
    async (request, reply) => {
      const email = request.body.email.toLowerCase()
      const [user] = await db
        .select()
        .from(users)
        .where(and(eq(users.email, email), isNull(users.deletedAt)))
        .limit(1)
      const { ok, needsRehash } = await verifyPassword(user, request.body.password)
      if (!user || !ok) throw app.httpErrors.unauthorized(INVALID_CREDENTIALS)

      if (needsRehash) {
        await db
          .update(users)
          .set({
            passwordHash: await hashPassword(request.body.password),
            passwordAlgo: 'argon2id',
          })
          .where(eq(users.id, user.id))
        request.log.info(
          { audit: 'password.rehash', userId: user.id },
          'upgraded legacy bcrypt hash',
        )
      }

      const { token } = await createSession(db, user.id, {
        userAgent: request.headers['user-agent'],
        ip: request.ip,
      })
      reply.setCookie(SESSION_COOKIE, token, sessionCookieOptions(env))
      request.log.info({ audit: 'auth.login', userId: user.id }, 'signed in')
      return toMe(user)
    },
  )

  app.post('/auth/logout', { schema: { tags: ['auth'] } }, async (request, reply) => {
    if (request.auth?.kind === 'session') {
      await db.delete(sessions).where(eq(sessions.id, request.auth.sessionId))
    }
    const { maxAge: _maxAge, signed: _signed, ...clearOptions } = sessionCookieOptions(env)
    reply.clearCookie(SESSION_COOKIE, clearOptions)
    return reply.code(204).send()
  })

  app.post(
    '/auth/logout-others',
    { schema: { tags: ['auth'], response: { 200: OkResponse } }, preHandler: requireSession },
    async (request) => {
      const auth = authOf(request)
      if (auth.kind !== 'session') throw app.httpErrors.forbidden()
      await db
        .delete(sessions)
        .where(and(eq(sessions.userId, userOf(request).id), ne(sessions.id, auth.sessionId)))
      return { ok: true as const }
    },
  )

  app.get(
    '/auth/sessions',
    { schema: { tags: ['auth'], response: { 200: SessionList } }, preHandler: requireSession },
    async (request) => {
      const auth = authOf(request)
      const rows = await db
        .select()
        .from(sessions)
        .where(and(eq(sessions.userId, userOf(request).id), gt(sessions.expiresAt, new Date())))
        .orderBy(desc(sessions.createdAt))
      return {
        sessions: rows.map((s) => ({
          id: s.id,
          created_at: s.createdAt.toISOString(),
          last_seen_at: s.lastSeenAt?.toISOString() ?? null,
          expires_at: s.expiresAt.toISOString(),
          user_agent: s.userAgent,
          ip: s.ip,
          current: auth.kind === 'session' && s.id === auth.sessionId,
        })),
      }
    },
  )

  app.post(
    '/auth/password/forgot',
    {
      schema: { tags: ['auth'], body: ForgotPasswordBody, response: { 200: OkResponse } },
      config: {
        rateLimit: {
          max: 3,
          timeWindow: '1 hour',
          keyGenerator: (req) =>
            `forgot:${String((req.body as { email?: string })?.email).toLowerCase()}`,
        },
      },
    },
    async (request) => {
      const email = request.body.email.toLowerCase()
      const [user] = await db
        .select()
        .from(users)
        .where(and(eq(users.email, email), isNull(users.deletedAt)))
        .limit(1)
      // Always the same response, and the email goes out in the background, so neither the body
      // nor the timing reveals whether the address has an account.
      if (user) {
        void issueResetToken(app.ctx, user, 'reset').catch((err) =>
          request.log.error({ err, userId: user.id }, 'failed to send password reset email'),
        )
      }
      return { ok: true as const }
    },
  )

  app.post(
    '/auth/password/reset',
    { schema: { tags: ['auth'], body: ResetPasswordBody, response: { 200: OkResponse } } },
    async (request) => {
      const [row] = await db
        .select()
        .from(passwordResetTokens)
        .where(
          and(
            eq(passwordResetTokens.tokenHash, sha256(request.body.token)),
            isNull(passwordResetTokens.consumedAt),
            gt(passwordResetTokens.expiresAt, new Date()),
          ),
        )
        .limit(1)
      if (!row) throw app.httpErrors.badRequest('This reset link is invalid or has expired')
      await assertNotBreached(request.body.new_password)
      const passwordHash = await hashPassword(request.body.new_password)

      await db.transaction(async (tx) => {
        // Consume every outstanding link for this user, not just the one used.
        await tx
          .update(passwordResetTokens)
          .set({ consumedAt: new Date() })
          .where(
            and(eq(passwordResetTokens.userId, row.userId), isNull(passwordResetTokens.consumedAt)),
          )
        await tx
          .update(users)
          .set({ passwordHash, passwordAlgo: 'argon2id' })
          .where(eq(users.id, row.userId))
        // A reset signs the user out everywhere.
        await tx.delete(sessions).where(eq(sessions.userId, row.userId))
      })
      request.log.info(
        { audit: 'password.reset', userId: row.userId, purpose: row.purpose },
        'password reset; all sessions revoked',
      )
      return { ok: true as const }
    },
  )

  app.post(
    '/auth/password/change',
    {
      schema: { tags: ['auth'], body: ChangePasswordBody, response: { 200: OkResponse } },
      preHandler: requireSession,
    },
    async (request) => {
      const auth = authOf(request)
      const { ok } = await verifyPassword(userOf(request), request.body.current_password)
      if (!ok) throw app.httpErrors.badRequest('Current password is incorrect')
      await assertNotBreached(request.body.new_password)
      await db
        .update(users)
        .set({
          passwordHash: await hashPassword(request.body.new_password),
          passwordAlgo: 'argon2id',
        })
        .where(eq(users.id, userOf(request).id))
      if (request.body.revoke_other_sessions !== false && auth.kind === 'session') {
        await db
          .delete(sessions)
          .where(and(eq(sessions.userId, userOf(request).id), ne(sessions.id, auth.sessionId)))
      }
      request.log.info({ audit: 'password.change', userId: userOf(request).id }, 'password changed')
      return { ok: true as const }
    },
  )

  app.get(
    '/me',
    { schema: { tags: ['auth'], response: { 200: Me } }, preHandler: requireScope('profile:read') },
    async (request) => toMe(userOf(request)),
  )
}
