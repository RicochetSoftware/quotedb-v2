import type { CookieSerializeOptions } from '@fastify/cookie'
import { and, eq, gt, isNull } from 'drizzle-orm'
import type { Db } from '../db/client'
import { sessions, type User, users } from '../db/schema'
import type { Env } from '../env'
import { randomToken, sha256 } from '../lib/crypto'

export const SESSION_COOKIE = 'qdb_session'
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000

export function sessionCookieOptions(env: Env): CookieSerializeOptions {
  return {
    path: '/',
    httpOnly: true,
    secure: env.NODE_ENV === 'production' || env.APP_URL.startsWith('https://'),
    sameSite: 'lax',
    signed: true,
    maxAge: SESSION_TTL_MS / 1000,
    ...(env.COOKIE_DOMAIN ? { domain: env.COOKIE_DOMAIN } : {}),
  }
}

export async function createSession(
  db: Db | Parameters<Parameters<Db['transaction']>[0]>[0],
  userId: string,
  meta: { userAgent: string | undefined; ip: string },
): Promise<{ token: string; sessionId: string }> {
  const token = randomToken(32)
  const [row] = await db
    .insert(sessions)
    .values({
      userId,
      tokenHash: sha256(token),
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
      userAgent: meta.userAgent?.slice(0, 512) ?? null,
      ip: meta.ip,
    })
    .returning({ id: sessions.id })
  if (!row) throw new Error('failed to create session')
  return { token, sessionId: row.id }
}

/** Resolve a cookie token to its live session and (non-deleted) user. */
export async function findSession(
  db: Db | Parameters<Parameters<Db['transaction']>[0]>[0],
  token: string,
): Promise<{ sessionId: string; lastSeenAt: Date | null; user: User } | null> {
  const [row] = await db
    .select({ session: sessions, user: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(
      and(
        eq(sessions.tokenHash, sha256(token)),
        gt(sessions.expiresAt, new Date()),
        isNull(users.deletedAt),
      ),
    )
    .limit(1)
  if (!row) return null
  return { sessionId: row.session.id, lastSeenAt: row.session.lastSeenAt, user: row.user }
}
