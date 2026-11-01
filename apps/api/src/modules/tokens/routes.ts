import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'
import { IdParams, TokenCreateBody, TokenCreated, TokenList } from '@quotedb/shared'
import { and, desc, eq, isNull } from 'drizzle-orm'
import { formatToken, newTokenSecret, tokenPrefix } from '../../auth/api-token'
import { authOf, requireSession } from '../../auth/plugin'
import { apiTokens } from '../../db/schema'
import { sha256 } from '../../lib/crypto'
import { toApiToken } from '../../lib/serialize'

/** Personal access tokens. Session cookie only: a token can never mint, list or revoke tokens. */
export const tokenRoutes: FastifyPluginAsyncTypebox = async (app) => {
  const { db, env } = app.ctx
  const tokenEnv = env.NODE_ENV === 'production' ? 'live' : 'test'

  app.get(
    '/tokens',
    { schema: { tags: ['tokens'], response: { 200: TokenList } }, preHandler: requireSession },
    async (request) => {
      const rows = await db
        .select()
        .from(apiTokens)
        .where(and(eq(apiTokens.userId, authOf(request).user.id), isNull(apiTokens.revokedAt)))
        .orderBy(desc(apiTokens.createdAt))
      return { tokens: rows.map(toApiToken) }
    },
  )

  app.post(
    '/tokens',
    {
      schema: { tags: ['tokens'], body: TokenCreateBody, response: { 201: TokenCreated } },
      preHandler: requireSession,
    },
    async (request, reply) => {
      const { name, scopes, expires_at } = request.body
      const expiresAt = expires_at ? new Date(expires_at) : null
      if (expiresAt && expiresAt <= new Date()) {
        throw app.httpErrors.badRequest('expires_at must be in the future')
      }
      const id = crypto.randomUUID()
      const secret = newTokenSecret()
      const [row] = await db
        .insert(apiTokens)
        .values({
          id,
          userId: authOf(request).user.id,
          name,
          prefix: tokenPrefix(tokenEnv, id),
          tokenHash: sha256(secret),
          scopes,
          expiresAt,
        })
        .returning()
      if (!row) throw new Error('insert failed')
      request.log.info(
        { audit: 'token.create', tokenId: id, prefix: row.prefix, scopes },
        'api token created',
      )
      return reply.code(201).send({ ...toApiToken(row), token: formatToken(tokenEnv, id, secret) })
    },
  )

  app.delete(
    '/tokens/:id',
    { schema: { tags: ['tokens'], params: IdParams }, preHandler: requireSession },
    async (request, reply) => {
      const [row] = await db
        .update(apiTokens)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(apiTokens.id, request.params.id),
            eq(apiTokens.userId, authOf(request).user.id),
            isNull(apiTokens.revokedAt),
          ),
        )
        .returning({ id: apiTokens.id, prefix: apiTokens.prefix })
      if (!row) throw app.httpErrors.notFound('Token not found')
      request.log.info(
        { audit: 'token.revoke', tokenId: row.id, prefix: row.prefix },
        'api token revoked',
      )
      return reply.code(204).send()
    },
  )
}
