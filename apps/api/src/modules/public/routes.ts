import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'
import { PublicQuote } from '@quotedb/shared'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { quotes, users } from '../../db/schema'
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
      if (!userId) throw app.httpErrors.notFound('No featured quotes configured')
      const [row] = await db
        .select({ quote: quotes, name: users.name })
        .from(quotes)
        .innerJoin(users, eq(users.id, quotes.userId))
        .where(and(eq(quotes.userId, userId), isNull(quotes.deletedAt), isNull(users.deletedAt)))
        .orderBy(sql`random()`)
        .limit(1)
      if (!row) throw app.httpErrors.notFound('No quotes yet')
      const { quote, author, date } = toQuote(row.quote)
      return { quote, author, date, added_by: row.name }
    },
  )
}
