import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'
import {
  CollectionTokenCreateBody,
  CollectionTokenParams,
  IdParams,
  TokenCreateBody,
  TokenCreated,
  TokenInfo,
  TokenList,
} from '@quotedb/shared'
import { and, desc, eq, isNull } from 'drizzle-orm'
import { formatToken, newTokenSecret, tokenPrefix } from '../../auth/api-token'
import { authOf, requireSession, userOf } from '../../auth/plugin'
import { apiTokens } from '../../db/schema'
import { sha256 } from '../../lib/crypto'
import { toApiToken } from '../../lib/serialize'
import { collectionAccess, personalCollection } from '../collections/access'

/** Personal access tokens. Session cookie only: a token can never mint, list or revoke tokens. */
export const tokenRoutes: FastifyPluginAsyncTypebox = async (app) => {
  const { db, env } = app.ctx
  const tokenEnv = env.NODE_ENV === 'production' ? 'live' : 'test'

  app.get(
    '/token-info',
    {
      schema: { tags: ['tokens'], response: { 200: TokenInfo } },
    },
    async (request, reply) => {
      const auth = authOf(request)
      if (auth.kind !== 'token') throw app.httpErrors.forbidden('API token required')
      const [token] = await db.select().from(apiTokens).where(eq(apiTokens.id, auth.tokenId))
      if (!token) throw app.httpErrors.unauthorized('Invalid API token')
      const { collection } = await collectionAccess(request, token.collectionId)
      reply.header('cache-control', 'no-store')
      return {
        ...(auth.user ? { owner: { id: auth.user.id, name: auth.user.name } } : {}),
        kind: token.kind,
        collection: { id: collection.id, name: collection.name, kind: collection.kind },
        prefix: auth.prefix,
        scopes: auth.scopes,
        expires_at: token.expiresAt?.toISOString() ?? null,
      }
    },
  )

  app.get(
    '/tokens',
    { schema: { tags: ['tokens'], response: { 200: TokenList } }, preHandler: requireSession },
    async (request) => {
      const rows = await db
        .select()
        .from(apiTokens)
        .where(and(eq(apiTokens.userId, userOf(request).id), isNull(apiTokens.revokedAt)))
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
          userId: userOf(request).id,
          issuedByUserId: userOf(request).id,
          collectionId: (await personalCollection(db, userOf(request).id)).id,
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
            eq(apiTokens.userId, userOf(request).id),
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
  app.get(
    '/collections/:id/tokens',
    {
      schema: { tags: ['collections'], params: IdParams, response: { 200: TokenList } },
      preHandler: requireSession,
    },
    async (request) => {
      await collectionAccess(request, request.params.id, 'admin')
      const rows = await db
        .select()
        .from(apiTokens)
        .where(
          and(
            eq(apiTokens.collectionId, request.params.id),
            eq(apiTokens.kind, 'collection'),
            isNull(apiTokens.revokedAt),
          ),
        )
        .orderBy(desc(apiTokens.createdAt))
      return { tokens: rows.map(toApiToken) }
    },
  )
  app.post(
    '/collections/:id/tokens',
    {
      schema: {
        tags: ['collections'],
        params: IdParams,
        body: CollectionTokenCreateBody,
        response: { 201: TokenCreated },
      },
      preHandler: requireSession,
    },
    async (request, reply) => {
      const { collection } = await collectionAccess(request, request.params.id, 'admin')
      if (collection.kind !== 'shared')
        throw app.httpErrors.badRequest(
          'Convert this collection to shared before creating integration tokens',
        )
      const { name, scopes, expires_at } = request.body
      const expiresAt = expires_at ? new Date(expires_at) : null
      if (expiresAt && expiresAt <= new Date())
        throw app.httpErrors.badRequest('expires_at must be in the future')
      const id = crypto.randomUUID()
      const secret = newTokenSecret()
      const [token] = await db
        .insert(apiTokens)
        .values({
          id,
          kind: 'collection',
          collectionId: collection.id,
          issuedByUserId: userOf(request).id,
          name,
          scopes,
          expiresAt,
          prefix: tokenPrefix(tokenEnv, id),
          tokenHash: sha256(secret),
        })
        .returning()
      if (!token) throw new Error('Token insert failed')
      request.log.info(
        {
          audit: 'collection.token.create',
          collectionId: collection.id,
          tokenId: id,
          actorId: userOf(request).id,
        },
        'collection token created',
      )
      return reply
        .code(201)
        .send({ ...toApiToken(token), token: formatToken(tokenEnv, id, secret) })
    },
  )
  app.delete(
    '/collections/:id/tokens/:tokenId',
    {
      schema: { tags: ['collections'], params: CollectionTokenParams },
      preHandler: requireSession,
    },
    async (request, reply) => {
      await collectionAccess(request, request.params.id, 'admin')
      const [token] = await db
        .update(apiTokens)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(apiTokens.id, request.params.tokenId),
            eq(apiTokens.collectionId, request.params.id),
            eq(apiTokens.kind, 'collection'),
            isNull(apiTokens.revokedAt),
          ),
        )
        .returning({ id: apiTokens.id })
      if (!token) throw app.httpErrors.notFound('Token not found')
      return reply.code(204).send()
    },
  )
}
