import type { CollectionRole } from '@quotedb/shared'
import { and, eq, sql } from 'drizzle-orm'
import type { FastifyRequest } from 'fastify'
import { authOf } from '../../auth/plugin'
import type { Db } from '../../db/client'
import { collectionMembers, collections } from '../../db/schema'

export async function personalCollection(db: Pick<Db, 'select'>, userId: string) {
  const [collection] = await db
    .select()
    .from(collections)
    .where(eq(collections.personalOwnerId, userId))
  if (!collection) throw new Error('Personal collection missing')
  return collection
}
const ranks: Record<CollectionRole, number> = { viewer: 0, member: 1, admin: 2, owner: 3 }

/** All ordinary quote operations use this boundary, including legacy personal tokens. */
export async function collectionAccess(
  request: FastifyRequest,
  id?: string,
  minimum: CollectionRole = 'viewer',
  db: Pick<Db, 'select'> = request.server.ctx.db,
) {
  const auth = authOf(request)
  const collectionId =
    id ??
    (auth.kind === 'token' ? auth.collectionId : (await personalCollection(db, auth.user.id)).id)
  if (auth.kind === 'token' && collectionId !== auth.collectionId)
    throw request.server.httpErrors.notFound('Collection not found')
  const [collection] = await db.select().from(collections).where(eq(collections.id, collectionId))
  if (!collection) throw request.server.httpErrors.notFound('Collection not found')
  if (auth.kind === 'token' && auth.tokenKind === 'collection') {
    if (ranks[minimum] >= ranks.admin)
      throw request.server.httpErrors.forbidden('A signed-in collection administrator is required')
    return { collection, role: 'member' as CollectionRole }
  }
  if (!auth.user) throw request.server.httpErrors.unauthorized()
  const [membership] = await db
    .select()
    .from(collectionMembers)
    .where(
      and(
        eq(collectionMembers.collectionId, collectionId),
        eq(collectionMembers.userId, auth.user.id),
      ),
    )
  if (!membership) throw request.server.httpErrors.notFound('Collection not found')
  if (ranks[membership.role] < ranks[minimum])
    throw request.server.httpErrors.forbidden('Your collection role does not allow this action')
  return { collection, role: membership.role }
}

/** Collection visibility follows its current owner, not the original quote submitter. */
export function activeCollectionOwner() {
  return sql`exists (
    select 1 from collection_members owner_member
    join users collection_owner on collection_owner.id = owner_member.user_id
    where owner_member.collection_id = ${collections.id}
      and owner_member.role = 'owner' and collection_owner.deleted_at is null
  )`
}
