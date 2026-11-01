import postgres from 'postgres'
import { required } from './env.js'
import { decrypt, encrypt } from './security/credentials.js'

const sql = postgres(required('BOT_DATABASE_URL'), { max: 1, onnotice: () => {} })
try {
  const oldText = required('BOT_PREVIOUS_ENCRYPTION_KEY')
  const newText = required('BOT_ENCRYPTION_KEY')
  if (![oldText, newText].every((key) => /^[a-f\d]{64}$/i.test(key)))
    throw new Error('Invalid encryption keys')
  const oldKey = Buffer.from(oldText, 'hex')
  const newKey = Buffer.from(newText, 'hex')
  await sql.begin(async (tx) => {
    const rows =
      await tx`select guild_id, credential from discord_bot.guild_settings where credential is not null for update`
    for (const row of rows) {
      const credential = encrypt(
        newKey,
        row.guild_id,
        decrypt(oldKey, row.guild_id, row.credential),
      )
      await tx`update discord_bot.guild_settings set credential=${credential} where guild_id=${row.guild_id}`
    }
  })
  console.info('Bot credentials re-encrypted. Start the bot with the new encryption key.')
} catch {
  console.error(
    'Key rotation failed; the transaction was rolled back. Check the old key and database connection.',
  )
  process.exitCode = 1
} finally {
  await sql.end()
}
