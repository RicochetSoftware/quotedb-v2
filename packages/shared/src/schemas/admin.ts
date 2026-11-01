import Type from 'typebox'
import { CollectionSummary } from './collections'
import { DateOrTimestamp, Email, Paging, RoleSchema, StatusFilter, Timestamp, Uuid } from './common'
import { AUTHOR_MAX_LENGTH, QUOTE_MAX_LENGTH, Quote } from './quotes'

const nullable = <T extends Type.TSchema>(schema: T) => Type.Union([schema, Type.Null()])

export const AdminUser = Type.Object({
  id: Uuid,
  email: Type.String(),
  name: Type.String(),
  role: RoleSchema,
  external_id: nullable(Type.Integer()),
  quote_count: Type.Integer(),
  created_at: Timestamp,
  updated_at: Timestamp,
  deleted_at: nullable(Timestamp),
})

export const AdminUserListQuery = Type.Object({
  q: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
  role: Type.Optional(RoleSchema),
  status: Type.Optional(StatusFilter),
  ...Paging,
})

export const AdminUserList = Type.Object({
  users: Type.Array(AdminUser),
  total: Type.Integer(),
  page: Type.Integer(),
  page_size: Type.Integer(),
})

export const AdminUserCreateBody = Type.Object(
  {
    email: Email,
    name: Type.String({ minLength: 1, maxLength: 255 }),
    role: Type.Optional(RoleSchema),
  },
  { additionalProperties: false },
)

export const AdminUserUpdateBody = Type.Object(
  {
    email: Type.Optional(Email),
    name: Type.Optional(Type.String({ minLength: 1, maxLength: 255 })),
    role: Type.Optional(RoleSchema),
  },
  { additionalProperties: false, minProperties: 1 },
)

export const AdminQuoteUser = Type.Object({ id: Uuid, name: Type.String(), email: Type.String() })

export const AdminQuote = Type.Object({
  ...Quote.properties,
  external_id: nullable(Type.Integer()),
  deleted_at: nullable(Timestamp),
  user: nullable(AdminQuoteUser),
  collection: CollectionSummary,
})

export const AdminQuoteListQuery = Type.Object({
  collection_id: Type.Optional(Uuid),
  user_id: Type.Optional(Uuid),
  author: Type.Optional(Type.String({ minLength: 1, maxLength: AUTHOR_MAX_LENGTH })),
  q: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
  from: Type.Optional(Type.String({ format: 'date' })),
  to: Type.Optional(Type.String({ format: 'date' })),
  status: Type.Optional(StatusFilter),
  ...Paging,
})

export const AdminQuoteList = Type.Object({
  quotes: Type.Array(AdminQuote),
  total: Type.Integer(),
  page: Type.Integer(),
  page_size: Type.Integer(),
})

export const AdminQuoteCreateBody = Type.Object(
  {
    collection_id: Type.Optional(Uuid),
    user_id: Type.Optional(Uuid),
    quote: Type.String({ minLength: 1, maxLength: QUOTE_MAX_LENGTH }),
    author: Type.String({ minLength: 1, maxLength: AUTHOR_MAX_LENGTH }),
    date: Type.Optional(DateOrTimestamp),
  },
  { additionalProperties: false },
)

export const AdminQuoteUpdateBody = Type.Object(
  {
    collection_id: Type.Optional(Uuid),
    user_id: Type.Optional(Uuid),
    quote: Type.Optional(Type.String({ minLength: 1, maxLength: QUOTE_MAX_LENGTH })),
    author: Type.Optional(Type.String({ minLength: 1, maxLength: AUTHOR_MAX_LENGTH })),
    date: Type.Optional(DateOrTimestamp),
  },
  { additionalProperties: false, minProperties: 1 },
)

export const AdminStats = Type.Object({
  users: Type.Object({ total: Type.Integer(), admins: Type.Integer(), deleted: Type.Integer() }),
  quotes: Type.Object({
    total: Type.Integer(),
    deleted: Type.Integer(),
    last_7_days: Type.Integer(),
  }),
  recent_quotes: Type.Array(AdminQuote),
})

export type AdminUser = Type.Static<typeof AdminUser>
export type AdminUserListQuery = Type.Static<typeof AdminUserListQuery>
export type AdminUserList = Type.Static<typeof AdminUserList>
export type AdminUserCreateBody = Type.Static<typeof AdminUserCreateBody>
export type AdminUserUpdateBody = Type.Static<typeof AdminUserUpdateBody>
export type AdminQuote = Type.Static<typeof AdminQuote>
export type AdminQuoteListQuery = Type.Static<typeof AdminQuoteListQuery>
export type AdminQuoteList = Type.Static<typeof AdminQuoteList>
export type AdminQuoteCreateBody = Type.Static<typeof AdminQuoteCreateBody>
export type AdminQuoteUpdateBody = Type.Static<typeof AdminQuoteUpdateBody>
export type AdminStats = Type.Static<typeof AdminStats>

export const AdminCollectionList = Type.Object({ collections: Type.Array(CollectionSummary) })
export type AdminCollectionList = Type.Static<typeof AdminCollectionList>
