import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'
import {
  AdminQuote,
  AdminQuoteCreateBody,
  AdminQuoteList,
  AdminQuoteListQuery,
  AdminQuoteUpdateBody,
  AdminStats,
  AdminUser,
  AdminUserCreateBody,
  AdminUserList,
  AdminUserListQuery,
  AdminUserUpdateBody,
  IdParams,
  OkResponse,
  QuoteList,
  type Role,
  type StatusFilter,
} from '@quotedb/shared'
import {
  and,
  count,
  desc,
  eq,
  getTableColumns,
  gte,
  ilike,
  isNotNull,
  isNull,
  lt,
  or,
  type SQL,
  sql,
} from 'drizzle-orm'
import type { PgColumn } from 'drizzle-orm/pg-core'
import { authOf, requireAdmin } from '../../auth/plugin'
import { quotes, sessions, type User, users } from '../../db/schema'
import { hashPassword } from '../../lib/passwords'
import {
  likeContains,
  parseBackdate,
  toAdminQuote,
  toAdminUser,
  toQuote,
} from '../../lib/serialize'
import { issueResetToken } from '../auth/reset'

function statusCondition(column: PgColumn, status: StatusFilter = 'active'): SQL | undefined {
  if (status === 'active') return isNull(column)
  if (status === 'deleted') return isNotNull(column)
  return undefined
}

function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } }
  return e?.code === '23505' || e?.cause?.code === '23505'
}

/**
 * Who may manage whom. SUPER_ADMIN manages everyone. ADMIN manages USERs only and can't hand out
 * SUPER_ADMIN. Nobody can change their own role or delete themselves (prevents lock-out).
 */
function assertCanManage(actor: User, target: User, change: { role?: Role; remove?: boolean }) {
  if (actor.id === target.id) {
    if (change.remove) return 'You cannot delete your own account'
    if (change.role && change.role !== target.role) return 'You cannot change your own role'
    return null
  }
  if (actor.role === 'SUPER_ADMIN') return null
  if (target.role !== 'USER') return 'Only a super admin can manage other admins'
  if (change.role === 'SUPER_ADMIN') return 'Only a super admin can grant SUPER_ADMIN'
  return null
}

export const adminRoutes: FastifyPluginAsyncTypebox = async (app) => {
  const { db } = app.ctx
  app.addHook('preHandler', requireAdmin)

  const quoteCount = sql<number>`(
    select count(*)::int from ${quotes} where ${quotes.userId} = ${users.id} and ${quotes.deletedAt} is null
  )`

  async function loadUser(id: string): Promise<User> {
    const [user] = await db.select().from(users).where(eq(users.id, id)).limit(1)
    if (!user) throw app.httpErrors.notFound('User not found')
    return user
  }

  async function adminUser(id: string): Promise<AdminUser> {
    const [row] = await db
      .select({ ...getTableColumns(users), quoteCount })
      .from(users)
      .where(eq(users.id, id))
      .limit(1)
    if (!row) throw app.httpErrors.notFound('User not found')
    return toAdminUser(row, row.quoteCount)
  }

  async function adminQuote(id: string): Promise<AdminQuote> {
    const [row] = await db
      .select({ quote: quotes, user: { id: users.id, name: users.name, email: users.email } })
      .from(quotes)
      .innerJoin(users, eq(users.id, quotes.userId))
      .where(eq(quotes.id, id))
      .limit(1)
    if (!row) throw app.httpErrors.notFound('Quote not found')
    return toAdminQuote(row.quote, row.user)
  }

  // ── stats ──

  app.get(
    '/admin/stats',
    { schema: { tags: ['admin'], response: { 200: AdminStats } } },
    async () => {
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
      const [userStats] = await db
        .select({
          total: sql<number>`count(*) filter (where ${users.deletedAt} is null)::int`,
          admins: sql<number>`count(*) filter (where ${users.deletedAt} is null and ${users.role} <> 'USER')::int`,
          deleted: sql<number>`count(*) filter (where ${users.deletedAt} is not null)::int`,
        })
        .from(users)
      const [quoteStats] = await db
        .select({
          total: sql<number>`count(*) filter (where ${quotes.deletedAt} is null)::int`,
          deleted: sql<number>`count(*) filter (where ${quotes.deletedAt} is not null)::int`,
          last_7_days: sql<number>`count(*) filter (where ${quotes.deletedAt} is null and ${quotes.createdAt} >= ${weekAgo}::timestamptz)::int`,
        })
        .from(quotes)
      const recent = await db
        .select({ quote: quotes, user: { id: users.id, name: users.name, email: users.email } })
        .from(quotes)
        .innerJoin(users, eq(users.id, quotes.userId))
        .where(isNull(quotes.deletedAt))
        .orderBy(desc(quotes.createdAt))
        .limit(5)
      return {
        users: userStats ?? { total: 0, admins: 0, deleted: 0 },
        quotes: quoteStats ?? { total: 0, deleted: 0, last_7_days: 0 },
        recent_quotes: recent.map((r) => toAdminQuote(r.quote, r.user)),
      }
    },
  )

  // ── users ──

  app.get(
    '/admin/users',
    {
      schema: {
        tags: ['admin'],
        querystring: AdminUserListQuery,
        response: { 200: AdminUserList },
      },
    },
    async (request) => {
      const { q, role, status, page = 1, page_size = 25 } = request.query
      const conditions = [statusCondition(users.deletedAt, status)]
      if (role) conditions.push(eq(users.role, role))
      if (q)
        conditions.push(or(ilike(users.name, likeContains(q)), ilike(users.email, likeContains(q))))
      const where = and(...conditions)
      const [rows, [total]] = await Promise.all([
        db
          .select({ ...getTableColumns(users), quoteCount })
          .from(users)
          .where(where)
          .orderBy(users.name)
          .limit(page_size)
          .offset((page - 1) * page_size),
        db.select({ n: count() }).from(users).where(where),
      ])
      return {
        users: rows.map((r) => toAdminUser(r, r.quoteCount)),
        total: total?.n ?? 0,
        page,
        page_size,
      }
    },
  )

  app.get(
    '/admin/users/:id',
    { schema: { tags: ['admin'], params: IdParams, response: { 200: AdminUser } } },
    async (request) => adminUser(request.params.id),
  )

  app.post(
    '/admin/users',
    { schema: { tags: ['admin'], body: AdminUserCreateBody, response: { 201: AdminUser } } },
    async (request, reply) => {
      const actor = authOf(request).user
      const { email, name, role = 'USER', password } = request.body
      if (role === 'SUPER_ADMIN' && actor.role !== 'SUPER_ADMIN') {
        throw app.httpErrors.forbidden('Only a super admin can grant SUPER_ADMIN')
      }
      if (password && (await app.ctx.isBreached(password))) {
        throw app.httpErrors.badRequest('This password has appeared in a known data breach')
      }
      let created: User | undefined
      try {
        ;[created] = await db
          .insert(users)
          .values({
            email: email.toLowerCase(),
            name,
            role,
            passwordHash: password ? await hashPassword(password) : null,
          })
          .returning()
      } catch (err) {
        if (isUniqueViolation(err))
          throw app.httpErrors.conflict('A user with this email already exists')
        throw err
      }
      if (!created) throw new Error('insert failed')
      if (!password) await issueResetToken(app.ctx, created, 'invite')
      request.log.info(
        { audit: 'admin.user.create', actorId: actor.id, userId: created.id, role },
        'user created',
      )
      return reply.code(201).send(toAdminUser(created, 0))
    },
  )

  app.patch(
    '/admin/users/:id',
    {
      schema: {
        tags: ['admin'],
        params: IdParams,
        body: AdminUserUpdateBody,
        response: { 200: AdminUser },
      },
    },
    async (request) => {
      const actor = authOf(request).user
      const target = await loadUser(request.params.id)
      const problem = assertCanManage(actor, target, { role: request.body.role })
      if (problem) throw app.httpErrors.forbidden(problem)
      const { email, name, role } = request.body
      try {
        await db
          .update(users)
          .set({
            ...(email !== undefined && { email: email.toLowerCase() }),
            ...(name !== undefined && { name }),
            ...(role !== undefined && { role }),
          })
          .where(eq(users.id, target.id))
      } catch (err) {
        if (isUniqueViolation(err))
          throw app.httpErrors.conflict('A user with this email already exists')
        throw err
      }
      request.log.info(
        { audit: 'admin.user.update', actorId: actor.id, userId: target.id, changes: request.body },
        'user updated',
      )
      return adminUser(target.id)
    },
  )

  app.delete(
    '/admin/users/:id',
    { schema: { tags: ['admin'], params: IdParams } },
    async (request, reply) => {
      const actor = authOf(request).user
      const target = await loadUser(request.params.id)
      const problem = assertCanManage(actor, target, { remove: true })
      if (problem) throw app.httpErrors.forbidden(problem)
      if (target.deletedAt) return reply.code(204).send()
      await db.transaction(async (tx) => {
        await tx.update(users).set({ deletedAt: new Date() }).where(eq(users.id, target.id))
        await tx.delete(sessions).where(eq(sessions.userId, target.id))
      })
      request.log.info(
        { audit: 'admin.user.delete', actorId: actor.id, userId: target.id },
        'user soft-deleted',
      )
      return reply.code(204).send()
    },
  )

  app.post(
    '/admin/users/:id/restore',
    { schema: { tags: ['admin'], params: IdParams, response: { 200: AdminUser } } },
    async (request) => {
      const actor = authOf(request).user
      const target = await loadUser(request.params.id)
      const problem = assertCanManage(actor, target, {})
      if (problem) throw app.httpErrors.forbidden(problem)
      await db.update(users).set({ deletedAt: null }).where(eq(users.id, target.id))
      request.log.info(
        { audit: 'admin.user.restore', actorId: actor.id, userId: target.id },
        'user restored',
      )
      return adminUser(target.id)
    },
  )

  app.post(
    '/admin/users/:id/password-reset',
    { schema: { tags: ['admin'], params: IdParams, response: { 200: OkResponse } } },
    async (request) => {
      const actor = authOf(request).user
      const target = await loadUser(request.params.id)
      const problem = assertCanManage(actor, target, {})
      if (problem) throw app.httpErrors.forbidden(problem)
      if (target.deletedAt) throw app.httpErrors.badRequest('Restore the user first')
      await issueResetToken(app.ctx, target, target.passwordHash ? 'reset' : 'invite')
      request.log.info(
        { audit: 'admin.user.password_reset', actorId: actor.id, userId: target.id },
        'reset email sent',
      )
      return { ok: true as const }
    },
  )

  app.get(
    '/admin/users/:id/quotes',
    { schema: { tags: ['admin'], params: IdParams, response: { 200: QuoteList } } },
    async (request) => {
      const target = await loadUser(request.params.id)
      const rows = await db
        .select()
        .from(quotes)
        .where(and(eq(quotes.userId, target.id), isNull(quotes.deletedAt)))
        .orderBy(desc(quotes.createdAt))
      return { quotes: rows.map(toQuote) }
    },
  )

  // ── quotes ──

  app.get(
    '/admin/quotes',
    {
      schema: {
        tags: ['admin'],
        querystring: AdminQuoteListQuery,
        response: { 200: AdminQuoteList },
      },
    },
    async (request) => {
      const { user_id, author, q, from, to, status, page = 1, page_size = 25 } = request.query
      const conditions = [statusCondition(quotes.deletedAt, status)]
      if (user_id) conditions.push(eq(quotes.userId, user_id))
      if (author) conditions.push(sql`lower(${quotes.author}) = lower(${author})`)
      if (q)
        conditions.push(
          or(ilike(quotes.quote, likeContains(q)), ilike(quotes.author, likeContains(q))),
        )
      if (from) conditions.push(gte(quotes.createdAt, parseBackdate(from)))
      if (to)
        conditions.push(lt(quotes.createdAt, new Date(parseBackdate(to).getTime() + 86_400_000)))
      const where = and(...conditions)
      const [rows, [total]] = await Promise.all([
        db
          .select({ quote: quotes, user: { id: users.id, name: users.name, email: users.email } })
          .from(quotes)
          .innerJoin(users, eq(users.id, quotes.userId))
          .where(where)
          .orderBy(desc(quotes.createdAt))
          .limit(page_size)
          .offset((page - 1) * page_size),
        db.select({ n: count() }).from(quotes).where(where),
      ])
      return {
        quotes: rows.map((r) => toAdminQuote(r.quote, r.user)),
        total: total?.n ?? 0,
        page,
        page_size,
      }
    },
  )

  app.get(
    '/admin/quotes/:id',
    { schema: { tags: ['admin'], params: IdParams, response: { 200: AdminQuote } } },
    async (request) => adminQuote(request.params.id),
  )

  app.post(
    '/admin/quotes',
    { schema: { tags: ['admin'], body: AdminQuoteCreateBody, response: { 201: AdminQuote } } },
    async (request, reply) => {
      const { user_id, quote, author, date } = request.body
      const owner = await loadUser(user_id)
      const [row] = await db
        .insert(quotes)
        .values({
          userId: owner.id,
          quote,
          author,
          createdAt: date ? parseBackdate(date) : new Date(),
        })
        .returning()
      if (!row) throw new Error('insert failed')
      request.log.info(
        {
          audit: 'admin.quote.create',
          actorId: authOf(request).user.id,
          quoteId: row.id,
          userId: owner.id,
        },
        'quote created for user',
      )
      return reply.code(201).send(toAdminQuote(row, owner))
    },
  )

  app.patch(
    '/admin/quotes/:id',
    {
      schema: {
        tags: ['admin'],
        params: IdParams,
        body: AdminQuoteUpdateBody,
        response: { 200: AdminQuote },
      },
    },
    async (request) => {
      const { user_id, quote, author, date } = request.body
      if (user_id) await loadUser(user_id)
      const [row] = await db
        .update(quotes)
        .set({
          ...(user_id !== undefined && { userId: user_id }),
          ...(quote !== undefined && { quote }),
          ...(author !== undefined && { author }),
          ...(date !== undefined && { createdAt: parseBackdate(date) }),
        })
        .where(eq(quotes.id, request.params.id))
        .returning({ id: quotes.id })
      if (!row) throw app.httpErrors.notFound('Quote not found')
      return adminQuote(row.id)
    },
  )

  app.delete(
    '/admin/quotes/:id',
    { schema: { tags: ['admin'], params: IdParams } },
    async (request, reply) => {
      const [row] = await db
        .update(quotes)
        .set({ deletedAt: sql`coalesce(${quotes.deletedAt}, now())` })
        .where(eq(quotes.id, request.params.id))
        .returning({ id: quotes.id })
      if (!row) throw app.httpErrors.notFound('Quote not found')
      return reply.code(204).send()
    },
  )

  app.post(
    '/admin/quotes/:id/restore',
    { schema: { tags: ['admin'], params: IdParams, response: { 200: AdminQuote } } },
    async (request) => {
      const [row] = await db
        .update(quotes)
        .set({ deletedAt: null })
        .where(eq(quotes.id, request.params.id))
        .returning({ id: quotes.id })
      if (!row) throw app.httpErrors.notFound('Quote not found')
      return adminQuote(row.id)
    },
  )
}
