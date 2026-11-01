import Type from 'typebox'
import { Email, RoleSchema, Timestamp, Uuid } from './common'

export const RequestCodeBody = Type.Object({ email: Email }, { additionalProperties: false })
export const CodeChallenge = Type.Object({
  challenge_id: Uuid,
  expires_in: Type.Integer(),
  retry_after: Type.Integer(),
})
export const VerifyCodeBody = Type.Object(
  {
    challenge_id: Uuid,
    code: Type.String({ pattern: '^[0-9]{6}$' }),
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

export type RequestCodeBody = Type.Static<typeof RequestCodeBody>
export type CodeChallenge = Type.Static<typeof CodeChallenge>
export type VerifyCodeBody = Type.Static<typeof VerifyCodeBody>
export type Me = Type.Static<typeof Me>
export type SessionInfo = Type.Static<typeof SessionInfo>
export type SessionList = Type.Static<typeof SessionList>
