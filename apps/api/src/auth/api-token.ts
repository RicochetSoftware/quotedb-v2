import type { Scope } from '@quotedb/shared'
import { eq } from 'drizzle-orm'
import type { Db } from '../db/client'
import { type ApiTokenRow, apiTokens, type User, users } from '../db/schema'
import { base62ToUuid, randomBase62, safeEqualHex, sha256, uuidToBase62 } from '../lib/crypto'

export type TokenEnv = 'live' | 'test'

/**
 * Token format (MIGRATION.md §3.6): `qdb_<env>_<id>_<secret>` where `id` is the row's UUID in base62
 * and `secret` is 32 random bytes in base62. Only sha256(secret) is stored.
 */
export function formatToken(env: TokenEnv, id: string, secret: string): string {
  return `${tokenPrefix(env, id)}_${secret}`
}

export function tokenPrefix(env: TokenEnv, id: string): string {
  return `qdb_${env}_${uuidToBase62(id)}`
}

export function newTokenSecret(): string {
  return randomBase62(32)
}

export function parseToken(raw: string): { env: TokenEnv; id: string; secret: string } | null {
  const parts = raw.split('_')
  if (parts.length !== 4) return null
  const [qdb, env, id62, secret] = parts as [string, string, string, string]
  if (qdb !== 'qdb' || (env !== 'live' && env !== 'test')) return null
  if (!/^[0-9A-Za-z]{1,22}$/.test(id62) || !/^[0-9A-Za-z]{20,64}$/.test(secret)) return null
  const id = base62ToUuid(id62)
  return id ? { env, id, secret } : null
}

export type TokenLookup =
  | { ok: true; token: ApiTokenRow; user: User }
  | { ok: false; reason: 'unknown' | 'revoked' | 'expired' | 'mismatch' | 'user-deleted' | 'env' }

/** O(1) lookup by id, then constant-time hash compare. Never scans rows. */
export async function verifyToken(
  db: Db,
  raw: string,
  expectedEnv: TokenEnv,
): Promise<TokenLookup | null> {
  const parsed = parseToken(raw)
  if (!parsed) return null
  if (parsed.env !== expectedEnv) return { ok: false, reason: 'env' }
  const [row] = await db
    .select({ token: apiTokens, user: users })
    .from(apiTokens)
    .innerJoin(users, eq(users.id, apiTokens.userId))
    .where(eq(apiTokens.id, parsed.id))
    .limit(1)
  if (!row) return { ok: false, reason: 'unknown' }
  if (!safeEqualHex(sha256(parsed.secret), row.token.tokenHash))
    return { ok: false, reason: 'mismatch' }
  if (row.token.revokedAt) return { ok: false, reason: 'revoked' }
  if (row.token.expiresAt && row.token.expiresAt <= new Date())
    return { ok: false, reason: 'expired' }
  if (row.user.deletedAt) return { ok: false, reason: 'user-deleted' }
  return { ok: true, token: row.token, user: row.user }
}

export function hasScope(scopes: readonly string[], scope: Scope): boolean {
  return scopes.includes(scope)
}
