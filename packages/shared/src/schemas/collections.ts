import Type from 'typebox'
import { Email, Timestamp, Uuid } from './common'

export const CollectionRole = Type.Union([
  Type.Literal('owner'),
  Type.Literal('admin'),
  Type.Literal('member'),
  Type.Literal('viewer'),
])
export type CollectionRole = Type.Static<typeof CollectionRole>
export const CollectionSummary = Type.Object({
  id: Uuid,
  name: Type.String(),
  kind: Type.Union([Type.Literal('personal'), Type.Literal('shared')]),
})
export const Collection = Type.Object({
  ...CollectionSummary.properties,
  role: CollectionRole,
  created_at: Timestamp,
})
export const CollectionList = Type.Object({ collections: Type.Array(Collection) })
export const CollectionCreateBody = Type.Object(
  { name: Type.String({ minLength: 1, maxLength: 100 }) },
  { additionalProperties: false },
)
export const CollectionUpdateBody = Type.Object(
  {
    name: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
    kind: Type.Optional(Type.Literal('shared')),
  },
  { additionalProperties: false, minProperties: 1 },
)
export const CollectionMember = Type.Object({
  user_id: Uuid,
  name: Type.String(),
  email: Type.String(),
  role: CollectionRole,
})
export const CollectionMemberList = Type.Object({ members: Type.Array(CollectionMember) })
export const CollectionMemberBody = Type.Object(
  {
    email: Email,
    role: Type.Union([Type.Literal('admin'), Type.Literal('member'), Type.Literal('viewer')]),
  },
  { additionalProperties: false },
)
export const CollectionTokenParams = Type.Object({ id: Uuid, tokenId: Uuid })
export const CollectionMemberParams = Type.Object({ id: Uuid, userId: Uuid })
export const CollectionTransferBody = Type.Object(
  { user_id: Uuid },
  { additionalProperties: false },
)
export type CollectionSummary = Type.Static<typeof CollectionSummary>
export type Collection = Type.Static<typeof Collection>
export type CollectionList = Type.Static<typeof CollectionList>
export type CollectionCreateBody = Type.Static<typeof CollectionCreateBody>
export type CollectionUpdateBody = Type.Static<typeof CollectionUpdateBody>
export type CollectionMember = Type.Static<typeof CollectionMember>
export type CollectionMemberBody = Type.Static<typeof CollectionMemberBody>
