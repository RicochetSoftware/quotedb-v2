import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'
import { Me, OkResponse, SessionList } from '@quotedb/shared'
import { and, desc, eq, gt, ne } from 'drizzle-orm'
import { authOf, requireScope, requireSession, userOf } from '../../auth/plugin'
import { SESSION_COOKIE, sessionCookieOptions } from '../../auth/session'
import { sessions } from '../../db/schema'
import { toMe } from '../../lib/serialize'
import { codeRoutes } from './codes'

export const authRoutes: FastifyPluginAsyncTypebox = async (app) => {
  const { db, env } = app.ctx
  await app.register(codeRoutes)

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

  app.get(
    '/me',
    { schema: { tags: ['auth'], response: { 200: Me } }, preHandler: requireScope('profile:read') },
    async (request) => toMe(userOf(request)),
  )
}
