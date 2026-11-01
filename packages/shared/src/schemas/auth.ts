import Type from 'typebox'
import { Email, NewPassword, RoleSchema, Timestamp, Uuid } from './common'

export const LoginBody = Type.Object(
  {
    email: Email,
    password: Type.String({ minLength: 1, maxLength: 1024 }),
  },
  { additionalProperties: false },
)

export const ForgotPasswordBody = Type.Object({ email: Email }, { additionalProperties: false })

export const ResetPasswordBody = Type.Object(
  {
    token: Type.String({ minLength: 1, maxLength: 512 }),
    new_password: NewPassword,
  },
  { additionalProperties: false },
)

export const ChangePasswordBody = Type.Object(
  {
    current_password: Type.String({ minLength: 1, maxLength: 1024 }),
    new_password: NewPassword,
    revoke_other_sessions: Type.Optional(Type.Boolean({ default: true })),
  },
  { additionalProperties: false },
)

export const Me = Type.Object({
  id: Uuid,
  email: Type.String(),
  name: Type.String(),
  role: RoleSchema,
  created_at: Timestamp,
})

export const SessionInfo = Type.Object({
  id: Uuid,
  created_at: Timestamp,
  last_seen_at: Type.Union([Timestamp, Type.Null()]),
  expires_at: Timestamp,
  user_agent: Type.Union([Type.String(), Type.Null()]),
  ip: Type.Union([Type.String(), Type.Null()]),
  current: Type.Boolean(),
})

export const SessionList = Type.Object({ sessions: Type.Array(SessionInfo) })

export const OkResponse = Type.Object({ ok: Type.Literal(true) })

export type LoginBody = Type.Static<typeof LoginBody>
export type ForgotPasswordBody = Type.Static<typeof ForgotPasswordBody>
export type ResetPasswordBody = Type.Static<typeof ResetPasswordBody>
export type ChangePasswordBody = Type.Static<typeof ChangePasswordBody>
export type Me = Type.Static<typeof Me>
export type SessionInfo = Type.Static<typeof SessionInfo>
export type SessionList = Type.Static<typeof SessionList>
