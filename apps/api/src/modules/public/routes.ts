import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'
import { PublicQuote } from '@quotedb/shared'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { collections, quotes, users } from '../../db/schema'
import { toQuote } from '../../lib/serialize'
import { resolveUserId } from '../quotes/routes'

/**
 * `/izaro` parity: v1 showed one random quote from a fixed user to anyone, signed in or not.
 * The user is configured with IZARO_USER_ID (UUID or legacy integer id).
 */
export const publicRoutes: FastifyPluginAsyncTypebox = async (app) => {
  const { db, env } = app.ctx

  app.get(
    '/public/izaro',
    { schema: { tags: ['public'], response: { 200: PublicQuote } } },
    async (_request, reply) => {
      reply.header('cache-control', 'no-store')
      const userId = env.IZARO_USER_ID ? await resolveUserId(db, env.IZARO_USER_ID) : null
      const [personal] = userId
        ? await db
            .select()
            .from(collections)
            .innerJoin(users, eq(users.id, collections.personalOwnerId))
            .where(and(eq(collections.personalOwnerId, userId), isNull(users.deletedAt)))
        : []
      const collectionId = env.IZARO_COLLECTION_ID ?? personal?.collections.id
      if (!collectionId) throw app.httpErrors.notFound('No featured quotes configured')
      const [row] = await db
        .select({ quote: quotes, name: collections.name })
        .from(quotes)
        .innerJoin(collections, eq(collections.id, quotes.collectionId))
        .where(and(eq(quotes.collectionId, collectionId), isNull(quotes.deletedAt)))
        .orderBy(sql`random()`)
        .limit(1)
      if (!row) throw app.httpErrors.notFound('No quotes yet')
      const { quote, author, date } = toQuote(row.quote)
      return {
        quote,
        author,
        date,
        added_by: env.IZARO_COLLECTION_ID ? row.name : (personal?.users.name ?? row.name),
      }
    },
  )
}
