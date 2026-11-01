import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'
import {
  IdParams,
  LegacyQuoteList,
  LegacyQuotesQuery,
  LegacyUserParams,
  Quote,
  QuoteCreateBody,
  QuoteList,
  QuoteListQuery,
  QuoteUpdateBody,
  RandomQuoteQuery,
} from '@quotedb/shared'
import { and, desc, eq, ilike, isNull, or, type SQL, sql } from 'drizzle-orm'
import { authOf, requireScope } from '../../auth/plugin'
import type { Db } from '../../db/client'
import { quotes, users } from '../../db/schema'
import { likeContains, parseBackdate, toQuote } from '../../lib/serialize'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Resolve a UUID or legacy integer id (`users.external_id`) to a user id. */
export async function resolveUserId(db: Db, id: string): Promise<string | null> {
  if (UUID_RE.test(id)) return id.toLowerCase()
  if (!/^\d{1,9}$/.test(id)) return null
  const [row] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.externalId, Number(id)))
    .limit(1)
  return row?.id ?? null
}

/** Quote filters: own, not deleted, optional author (case-insensitive exact) and free-text `q`. */
function ownQuotes(userId: string, filters: { author?: string; q?: string } = {}): SQL {
  const conditions: SQL[] = [eq(quotes.userId, userId), isNull(quotes.deletedAt)]
  if (filters.author) conditions.push(sql`lower(${quotes.author}) = lower(${filters.author})`)
  if (filters.q) {
    const pattern = likeContains(filters.q)
    const match = or(ilike(quotes.quote, pattern), ilike(quotes.author, pattern))
    if (match) conditions.push(match)
  }
  return and(...conditions) as SQL
}

export const quoteRoutes: FastifyPluginAsyncTypebox = async (app) => {
  const { db } = app.ctx
  const read = requireScope('quotes:read')
  const write = requireScope('quotes:write')

  app.get(
    '/quotes',
    {
      schema: { tags: ['quotes'], querystring: QuoteListQuery, response: { 200: QuoteList } },
      preHandler: read,
    },
    async (request) => {
      const { max = 1000, author, q } = request.query
      const rows = await db
        .select()
        .from(quotes)
        .where(ownQuotes(authOf(request).user.id, { author, q }))
        .orderBy(desc(quotes.createdAt))
        .limit(max)
      return { quotes: rows.map(toQuote) }
    },
  )

  app.get(
    '/quotes/random',
    {
      schema: { tags: ['quotes'], querystring: RandomQuoteQuery, response: { 200: QuoteList } },
      preHandler: read,
    },
    async (request, reply) => {
      // Random results must never be cached by an intermediary (v1 bug #58).
      reply.header('cache-control', 'no-store')
      const rows = await db
        .select()
        .from(quotes)
        .where(ownQuotes(authOf(request).user.id))
        .orderBy(sql`random()`)
        .limit(request.query.max ?? 1)
      return { quotes: rows.map(toQuote) }
    },
  )

  app.get(
    '/quotes/:id',
    { schema: { tags: ['quotes'], params: IdParams, response: { 200: Quote } }, preHandler: read },
    async (request) => {
      const [row] = await db
        .select()
        .from(quotes)
        .where(and(eq(quotes.id, request.params.id), ownQuotes(authOf(request).user.id)))
        .limit(1)
      // 404 (not 403) for other users' quotes, so ids don't leak existence.
      if (!row) throw app.httpErrors.notFound('Quote not found')
      return toQuote(row)
    },
  )

  app.post(
    '/quotes',
    {
      schema: { tags: ['quotes'], body: QuoteCreateBody, response: { 201: Quote } },
      preHandler: write,
    },
    async (request, reply) => {
      const { quote, author, date } = request.body
      const createdAt = date ? parseBackdate(date) : new Date()
      const [row] = await db
        .insert(quotes)
        .values({
          userId: authOf(request).user.id,
          quote,
          author,
          createdAt,
          updatedAt: new Date(),
        })
        .returning()
      if (!row) throw new Error('insert failed')
      return reply.code(201).send(toQuote(row))
    },
  )

  app.patch(
    '/quotes/:id',
    {
      schema: {
        tags: ['quotes'],
        params: IdParams,
        body: QuoteUpdateBody,
        response: { 200: Quote },
      },
      preHandler: write,
    },
    async (request) => {
      const { quote, author, date } = request.body
      const [row] = await db
        .update(quotes)
        .set({
          ...(quote !== undefined && { quote }),
          ...(author !== undefined && { author }),
          ...(date !== undefined && { createdAt: parseBackdate(date) }),
        })
        .where(and(eq(quotes.id, request.params.id), ownQuotes(authOf(request).user.id)))
        .returning()
      if (!row) throw app.httpErrors.notFound('Quote not found')
      return toQuote(row)
    },
  )

  app.delete(
    '/quotes/:id',
    { schema: { tags: ['quotes'], params: IdParams }, preHandler: write },
    async (request, reply) => {
      const [row] = await db
        .update(quotes)
        .set({ deletedAt: new Date() })
        .where(and(eq(quotes.id, request.params.id), ownQuotes(authOf(request).user.id)))
        .returning({ id: quotes.id })
      if (!row) throw app.httpErrors.notFound('Quote not found')
      return reply.code(204).send()
    },
  )

  // ── v1 back-compat shim (MIGRATION.md §3.4/§4.2). Self-only; remove in the v2 release. ──

  async function legacyList(
    request: { params: { id: string }; query: { max_quotes: number } } & Parameters<
      typeof authOf
    >[0],
    order: 'latest' | 'random',
  ) {
    const auth = authOf(request)
    const userId = await resolveUserId(db, request.params.id)
    if (userId !== auth.user.id) throw app.httpErrors.forbidden('You can only read your own quotes')
    const rows = await db
      .select()
      .from(quotes)
      .where(ownQuotes(userId))
      .orderBy(order === 'random' ? sql`random()` : desc(quotes.createdAt))
      .limit(request.query.max_quotes)
    return {
      quotes: rows.map((r) => ({
        id: r.id,
        quote: r.quote,
        author: r.author,
        date: toQuote(r).date,
      })),
    }
  }

  const legacySchema = {
    tags: ['legacy'],
    deprecated: true,
    params: LegacyUserParams,
    querystring: LegacyQuotesQuery,
    response: { 200: LegacyQuoteList },
  }

  app.get('/quotes/search/user/:id', { schema: legacySchema, preHandler: read }, (request) =>
    legacyList(request, 'latest'),
  )

  app.get(
    '/quotes/random/user/:id',
    { schema: legacySchema, preHandler: read },
    (request, reply) => {
      reply.header('cache-control', 'no-store')
      return legacyList(request, 'random')
    },
  )
}
