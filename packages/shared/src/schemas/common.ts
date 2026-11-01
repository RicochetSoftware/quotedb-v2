import Type from 'typebox'
import type { Role } from '../roles'

export const Uuid = Type.String({ format: 'uuid' })

export const Timestamp = Type.String({ format: 'date-time' })

/** A calendar date (`2026-10-21`) or a full ISO timestamp. */
export const DateOrTimestamp = Type.Union([
  Type.String({ format: 'date' }),
  Type.String({ format: 'date-time' }),
])

export const Email = Type.String({ format: 'email', maxLength: 254 })

export const RoleSchema = Type.Union([
  Type.Literal('USER'),
  Type.Literal('ADMIN'),
  Type.Literal('SUPER_ADMIN'),
])

// Keep RoleSchema in sync with ROLES.
const _roleCheck: Role extends Type.Static<typeof RoleSchema> ? true : never = true

export const IdParams = Type.Object({ id: Uuid })

export const ErrorResponse = Type.Object({
  statusCode: Type.Integer(),
  error: Type.String(),
  message: Type.String(),
})

export const Paging = {
  page: Type.Optional(Type.Integer({ minimum: 1, default: 1 })),
  page_size: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 25 })),
}

export const StatusFilter = Type.Union([
  Type.Literal('active'),
  Type.Literal('deleted'),
  Type.Literal('all'),
])

export type ErrorResponse = Type.Static<typeof ErrorResponse>
export type StatusFilter = Type.Static<typeof StatusFilter>
