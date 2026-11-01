import { createHash } from 'node:crypto'
import argon2 from 'argon2'
import bcrypt from 'bcryptjs'
import type { User } from '../db/schema'

export function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, { type: argon2.argon2id })
}

let dummyHash: Promise<string> | undefined

/**
 * Verify a password against a user's stored hash. `needsRehash` is true for v1 bcrypt hashes,
 * which the caller upgrades to argon2id after a successful login (MIGRATION.md §2.5).
 */
export async function verifyPassword(
  user: Pick<User, 'passwordHash' | 'passwordAlgo'> | undefined,
  plain: string,
): Promise<{ ok: boolean; needsRehash: boolean }> {
  if (!user?.passwordHash) {
    // Spend the same time as a real verify so response timing doesn't reveal whether the email exists.
    dummyHash ??= hashPassword('timing-equaliser-not-a-real-password')
    await argon2.verify(await dummyHash, plain).catch(() => false)
    return { ok: false, needsRehash: false }
  }
  if (user.passwordAlgo === 'bcrypt-legacy') {
    // Laravel writes `$2y$`; it is the same algorithm as `$2b$`.
    const hash = user.passwordHash.replace(/^\$2y\$/, '$2b$')
    const ok = await bcrypt.compare(plain, hash).catch(() => false)
    return { ok, needsRehash: ok }
  }
  const ok = await argon2.verify(user.passwordHash, plain).catch(() => false)
  return { ok, needsRehash: false }
}

export type BreachChecker = (password: string) => Promise<boolean>

/**
 * Have I Been Pwned k-anonymity lookup: only the first 5 hex chars of the SHA-1 leave the server.
 * Fails open (returns false) if the API is unreachable, so an outage can't block password changes.
 */
export function createHibpChecker(
  log: { warn: (obj: object, msg: string) => void },
  fetchImpl: typeof fetch = fetch,
): BreachChecker {
  return async (password) => {
    const sha1 = createHash('sha1').update(password).digest('hex').toUpperCase()
    const prefix = sha1.slice(0, 5)
    const suffix = sha1.slice(5)
    try {
      const res = await fetchImpl(`https://api.pwnedpasswords.com/range/${prefix}`, {
        headers: { 'Add-Padding': 'true', 'User-Agent': 'quotedb' },
        signal: AbortSignal.timeout(3000),
      })
      if (!res.ok) throw new Error(`HIBP responded ${res.status}`)
      const body = await res.text()
      return body.split('\n').some((line) => {
        const [hashSuffix, count] = line.trim().split(':')
        return hashSuffix === suffix && Number(count) > 0
      })
    } catch (err) {
      log.warn({ err }, 'HIBP check failed; allowing password')
      return false
    }
  }
}

export const noBreachCheck: BreachChecker = async () => false
