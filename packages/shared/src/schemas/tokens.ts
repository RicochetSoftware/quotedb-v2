import Type from 'typebox'
import type { Scope } from '../scopes'
import { CollectionSummary } from './collections'
import { Timestamp, Uuid } from './common'

export const ScopeSchema = Type.Union([
  Type.Literal('quotes:read'),
  Type.Literal('quotes:write'),
  Type.Literal('profile:read'),
])

// Keep ScopeSchema in sync with SCOPES.
const _scopeCheck: Scope extends Type.Static<typeof ScopeSchema> ? true : never = true

export const TokenCreateBody = Type.Object(
  {
    name: Type.String({ minLength: 1, maxLength: 100 }),
    scopes: Type.Array(ScopeSchema, { minItems: 1, uniqueItems: true }),
    /** `null` (or omitted) = never expires. */
    expires_at: Type.Optional(Type.Union([Timestamp, Type.Null()])),
  },
  { additionalProperties: false },
)

export const CollectionTokenCreateBody = Type.Object(
  {
    name: Type.String({ minLength: 1, maxLength: 100 }),
    scopes: Type.Array(Type.Union([Type.Literal('quotes:read'), Type.Literal('quotes:write')]), {
      minItems: 1,
      uniqueItems: true,
    }),
    expires_at: Type.Optional(Type.Union([Timestamp, Type.Null()])),
  },
  { additionalProperties: false },
)
export type CollectionTokenCreateBody = Type.Static<typeof CollectionTokenCreateBody>

export const ApiToken = Type.Object({
  kind: Type.Union([Type.Literal('personal'), Type.Literal('collection')]),
  collection_id: Uuid,
  id: Uuid,
  name: Type.String(),
  prefix: Type.String(),
  scopes: Type.Array(ScopeSchema),
  expires_at: Type.Union([Timestamp, Type.Null()]),
  last_used_at: Type.Union([Timestamp, Type.Null()]),
  created_at: Timestamp,
})

export const TokenCreated = Type.Object({
  ...ApiToken.properties,
  /** The full secret token. Returned exactly once, at creation. */
  token: Type.String(),
})

export const TokenList = Type.Object({ tokens: Type.Array(ApiToken) })

export type TokenCreateBody = Type.Static<typeof TokenCreateBody>
export type ApiToken = Type.Static<typeof ApiToken>
export type TokenCreated = Type.Static<typeof TokenCreated>
export type TokenList = Type.Static<typeof TokenList>

export const TokenInfo = Type.Object({
  owner: Type.Optional(Type.Object({ id: Uuid, name: Type.String() })),
  kind: Type.Union([Type.Literal('personal'), Type.Literal('collection')]),
  collection: CollectionSummary,
  prefix: Type.String(),
  scopes: Type.Array(ScopeSchema),
  expires_at: Type.Union([Timestamp, Type.Null()]),
})
export type TokenInfo = Type.Static<typeof TokenInfo>
