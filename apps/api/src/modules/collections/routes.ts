import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'
import {
  Collection,
  CollectionCreateBody,
  CollectionList,
  CollectionMemberBody,
  CollectionMemberList,
  CollectionMemberParams,
  CollectionTransferBody,
  CollectionUpdateBody,
  IdParams,
} from '@quotedb/shared'
import { and, asc, eq, isNull, sql } from 'drizzle-orm'
import { requireSession, userOf } from '../../auth/plugin'
import { collectionMembers, collections, users } from '../../db/schema'
import { collectionAccess } from './access'

export const collectionRoutes: FastifyPluginAsyncTypebox = async (app) => {
  const { db } = app.ctx
  app.addHook('preHandler', requireSession)
  app.get(
    '/collections',
    { schema: { tags: ['collections'], response: { 200: CollectionList } } },
    async (request) => {
      const rows = await db
        .select({ collection: collections, role: collectionMembers.role })
        .from(collections)
        .innerJoin(collectionMembers, eq(collectionMembers.collectionId, collections.id))
        .where(eq(collectionMembers.userId, userOf(request).id))
        .orderBy(asc(collections.kind), asc(collections.createdAt))
      return {
        collections: rows.map(({ collection: c, role }) => ({
          id: c.id,
          name: c.name,
          kind: c.kind,
          role,
          created_at: c.createdAt.toISOString(),
        })),
      }
    },
  )
  app.post(
    '/collections',
    {
      schema: { tags: ['collections'], body: CollectionCreateBody, response: { 201: Collection } },
    },
    async (request, reply) => {
      const name = request.body.name.trim()
      if (!name) throw app.httpErrors.badRequest('Name must not be blank')
      const collection = await db.transaction(async (tx) => {
        const [c] = await tx.insert(collections).values({ name, kind: 'shared' }).returning()
        if (!c) throw new Error('Collection insert failed')
        await tx
          .insert(collectionMembers)
          .values({ collectionId: c.id, userId: userOf(request).id, role: 'owner' })
        return c
      })
      return reply.code(201).send({
        id: collection.id,
        name,
        kind: collection.kind,
        role: 'owner' as const,
        created_at: collection.createdAt.toISOString(),
      })
    },
  )
  app.patch(
    '/collections/:id',
    {
      schema: {
        tags: ['collections'],
        params: IdParams,
        body: CollectionUpdateBody,
        response: { 200: Collection },
      },
    },
    async (request) => {
      const { collection, role } = await collectionAccess(request, request.params.id, 'admin')
      if (request.body.name !== undefined && !request.body.name.trim())
        throw app.httpErrors.badRequest('Name must not be blank')
      if (request.body.kind && role !== 'owner')
        throw app.httpErrors.forbidden('Only the owner can convert a personal collection')
      return db.transaction(async (tx) => {
        const [current] = await tx
          .select()
          .from(collections)
          .where(eq(collections.id, collection.id))
          .for('update')
        if (!current) throw app.httpErrors.notFound()
        await collectionAccess(
          request,
          request.params.id,
          request.body.kind ? 'owner' : 'admin',
          tx,
        )
        if (request.body.kind === 'shared' && current.kind === 'personal') {
          await tx
            .update(collections)
            .set({ kind: 'shared', personalOwnerId: null })
            .where(eq(collections.id, current.id))
          const ownerId = current.personalOwnerId
          if (!ownerId) throw new Error('Personal collection owner missing')
          const [newPersonal] = await tx
            .insert(collections)
            .values({ name: 'Personal quotes', kind: 'personal', personalOwnerId: ownerId })
            .returning()
          if (!newPersonal) throw new Error('Personal collection insert failed')
          await tx
            .insert(collectionMembers)
            .values({ collectionId: newPersonal.id, userId: ownerId, role: 'owner' })
        }
        const [updated] = await tx
          .update(collections)
          .set({
            ...(request.body.name !== undefined ? { name: request.body.name.trim() } : {}),
            updatedAt: new Date(),
          })
          .where(eq(collections.id, collection.id))
          .returning()
        if (!updated) throw new Error('Collection update failed')
        return {
          id: updated.id,
          name: updated.name,
          kind: updated.kind,
          role,
          created_at: updated.createdAt.toISOString(),
        }
      })
    },
  )
  app.get(
    '/collections/:id/members',
    {
      schema: { tags: ['collections'], params: IdParams, response: { 200: CollectionMemberList } },
    },
    async (request) => {
      await collectionAccess(request, request.params.id, 'admin')
      const members = await db
        .select({
          user_id: users.id,
          name: users.name,
          email: users.email,
          role: collectionMembers.role,
        })
        .from(collectionMembers)
        .innerJoin(users, eq(users.id, collectionMembers.userId))
        .where(and(eq(collectionMembers.collectionId, request.params.id), isNull(users.deletedAt)))
      return { members }
    },
  )
  app.put(
    '/collections/:id/members',
    { schema: { tags: ['collections'], params: IdParams, body: CollectionMemberBody } },
    async (request, reply) => {
      await db.transaction(async (tx) => {
        // Serialize membership changes and owner transfers for this collection.
        await tx.execute(sql`select id from collections where id=${request.params.id} for update`)
        const access = await collectionAccess(request, request.params.id, 'admin', tx)
        if (access.collection.kind === 'personal')
          throw app.httpErrors.badRequest('Convert this collection to shared before adding members')
        const [target] = await tx
          .select()
          .from(users)
          .where(and(eq(users.email, request.body.email), isNull(users.deletedAt)))
        if (!target)
          throw app.httpErrors.notFound('An active QuoteDB account with that email is required')
        const [existing] = await tx
          .select()
          .from(collectionMembers)
          .where(
            and(
              eq(collectionMembers.collectionId, request.params.id),
              eq(collectionMembers.userId, target.id),
            ),
          )
        if (existing?.role === 'owner')
          throw app.httpErrors.forbidden('Use ownership transfer to change the owner')
        if (
          access.role !== 'owner' &&
          (existing?.role === 'admin' || request.body.role === 'admin')
        )
          throw app.httpErrors.forbidden('Only the owner can manage administrators')
        await tx
          .insert(collectionMembers)
          .values({ collectionId: request.params.id, userId: target.id, role: request.body.role })
          .onConflictDoUpdate({
            target: [collectionMembers.collectionId, collectionMembers.userId],
            set: { role: request.body.role },
          })
      })
      return reply.code(204).send()
    },
  )
  app.delete(
    '/collections/:id/members/:userId',
    { schema: { tags: ['collections'], params: CollectionMemberParams } },
    async (request, reply) => {
      await db.transaction(async (tx) => {
        await tx.execute(sql`select id from collections where id=${request.params.id} for update`)
        const access = await collectionAccess(request, request.params.id, 'admin', tx)
        const [target] = await tx
          .select()
          .from(collectionMembers)
          .where(
            and(
              eq(collectionMembers.collectionId, request.params.id),
              eq(collectionMembers.userId, request.params.userId),
            ),
          )
        if (!target) throw app.httpErrors.notFound('Member not found')
        if (target.role === 'owner')
          throw app.httpErrors.forbidden('Transfer ownership before removing the owner')
        if (target.role === 'admin' && access.role !== 'owner')
          throw app.httpErrors.forbidden('Only the owner can remove administrators')
        await tx
          .delete(collectionMembers)
          .where(
            and(
              eq(collectionMembers.collectionId, request.params.id),
              eq(collectionMembers.userId, request.params.userId),
            ),
          )
      })
      return reply.code(204).send()
    },
  )
  app.post(
    '/collections/:id/transfer',
    { schema: { tags: ['collections'], params: IdParams, body: CollectionTransferBody } },
    async (request, reply) => {
      await db.transaction(async (tx) => {
        await tx.execute(sql`select id from collections where id=${request.params.id} for update`)
        const access = await collectionAccess(request, request.params.id, 'owner', tx)
        if (access.collection.kind !== 'shared')
          throw app.httpErrors.badRequest('Personal collections cannot be transferred')
        const [target] = await tx
          .select()
          .from(collectionMembers)
          .innerJoin(users, eq(users.id, collectionMembers.userId))
          .where(
            and(
              eq(collectionMembers.collectionId, request.params.id),
              eq(collectionMembers.userId, request.body.user_id),
              isNull(users.deletedAt),
            ),
          )
        if (!target) throw app.httpErrors.notFound('Active collection member required')
        if (request.body.user_id === userOf(request).id) return
        await tx
          .update(collectionMembers)
          .set({ role: 'admin' })
          .where(
            and(
              eq(collectionMembers.collectionId, request.params.id),
              eq(collectionMembers.userId, userOf(request).id),
            ),
          )
        await tx
          .update(collectionMembers)
          .set({ role: 'owner' })
          .where(
            and(
              eq(collectionMembers.collectionId, request.params.id),
              eq(collectionMembers.userId, request.body.user_id),
            ),
          )
      })
      return reply.code(204).send()
    },
  )
}
