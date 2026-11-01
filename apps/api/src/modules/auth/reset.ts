import type { AppContext } from '../../context'
import { passwordResetTokens, type User } from '../../db/schema'
import { randomToken, sha256 } from '../../lib/crypto'
import { inviteEmail, passwordResetEmail } from '../../lib/emails'

const TTL_MS = { reset: 60 * 60 * 1000, invite: 7 * 24 * 60 * 60 * 1000 } as const

/** Store a single-use hashed token and email the link. Used by forgot-password, admin resets and invites. */
export async function issueResetToken(
  { db, env, mailer }: AppContext,
  user: Pick<User, 'id' | 'email' | 'name'>,
  purpose: 'reset' | 'invite',
): Promise<void> {
  const token = randomToken(32)
  await db.insert(passwordResetTokens).values({
    userId: user.id,
    tokenHash: sha256(token),
    purpose,
    expiresAt: new Date(Date.now() + TTL_MS[purpose]),
  })
  const link = `${env.WEB_URL}/reset-password?token=${encodeURIComponent(token)}`
  const message =
    purpose === 'invite'
      ? inviteEmail(user.email, user.name, `${link}&invite=1`)
      : passwordResetEmail(user.email, user.name, link)
  await mailer.send(message)
}
