import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import type postgres from 'postgres'
import { decrypt, encrypt } from '../security/credentials.js'

const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
function decodeId(id: string) {
  let n = 0n
  for (const c of id) {
    const digit = alphabet.indexOf(c)
    if (digit < 0) throw new Error('Invalid token ID')
    n = n * 62n + BigInt(digit)
  }
  const hex = n.toString(16).padStart(32, '0')
  if (hex.length !== 32) throw new Error('Invalid token ID')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
function encodeId(id: string) {
  let n = BigInt(`0x${id.replaceAll('-', '')}`)
  let result = ''
  do {
    result = alphabet[Number(n % 62n)] + result
    n /= 62n
  } while (n)
  return result
}

/** One-shot deployment migration; only the migration process can access core API tables.
 * Existing personal tokens are never modified or revoked. A separate collection token is minted
 * for each legacy bot connection, and its ciphertext is swapped in the same DB transaction.
 */
export async function upgradeConnections(sql: postgres.Sql, encryptionKey: Buffer | undefined) {
  const [{ present } = { present: null }] =
    await sql`select to_regclass('public.collections') as present`
  if (!present) return
  const pending =
    await sql`select guild_id from discord_bot.guild_settings where credential is not null and collection_id is null`
  if (!pending.length) return
  if (encryptionKey?.length !== 32)
    throw new Error('BOT_ENCRYPTION_KEY required to upgrade existing connections')
  await sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(71422908)`
    const rows =
      await tx`select * from discord_bot.guild_settings where credential is not null and collection_id is null for update`
    for (const row of rows) {
      const raw = decrypt(encryptionKey, row.guild_id, row.credential)
      const [prefix, environment, encodedId, secret, extra] = raw.split('_')
      if (
        prefix !== 'qdb' ||
        !['live', 'test'].includes(environment ?? '') ||
        !encodedId ||
        !secret ||
        extra
      )
        throw new Error('Invalid saved API credential')
      const id = decodeId(encodedId)
      const [token] =
        await tx`select t.*, u.deleted_at as user_deleted from api_tokens t left join users u on u.id=t.user_id where t.id=${id}`
      const hash = createHash('sha256').update(secret).digest()
      if (!token || !timingSafeEqual(hash, Buffer.from(token.token_hash, 'hex')))
        throw new Error('Saved credential does not match the API token')
      if (
        token.revoked_at ||
        (token.expires_at && new Date(token.expires_at) <= new Date()) ||
        (token.kind === 'personal' && (!token.user_id || token.user_deleted))
      )
        throw new Error('Reconnect expired or revoked bot credentials before migration')
      if (!token.scopes.includes('quotes:read') || !token.scopes.includes('quotes:write'))
        throw new Error('Saved bot key is missing required quote scopes')
      const [collection] =
        await tx`select * from collections where id=${token.collection_id} for update`
      if (!collection) throw new Error('Collection missing')
      if (collection.kind === 'personal') {
        // Conversion never moves or copies quotes; the account receives a fresh personal collection.
        await tx`update collections set kind='shared', personal_owner_id=null, updated_at=now() where id=${collection.id}`
        const personalId = randomUUID()
        await tx`insert into collections (id, name, kind, personal_owner_id) values (${personalId}, 'Personal quotes', 'personal', ${collection.personal_owner_id})`
        await tx`insert into collection_members (collection_id, user_id, role) values (${personalId}, ${collection.personal_owner_id}, 'owner')`
      }
      let credential = row.credential
      let safePrefix = token.prefix
      if (token.kind === 'personal') {
        const newId = randomUUID()
        const newSecret = randomBytes(32).toString('hex')
        safePrefix = `qdb_${environment}_${encodeId(newId)}`
        const tokenHash = createHash('sha256').update(newSecret).digest('hex')
        await tx`insert into api_tokens (id, kind, collection_id, issued_by_user_id, name, prefix, token_hash, scopes, expires_at)
          values (${newId}, 'collection', ${collection.id}, ${token.user_id}, ${`Discord ${row.guild_id}`}, ${safePrefix}, ${tokenHash}, array['quotes:read','quotes:write'], ${token.expires_at})`
        credential = encrypt(encryptionKey, row.guild_id, `${safePrefix}_${newSecret}`)
      }
      await tx`update discord_bot.guild_settings set collection_id=${collection.id}, collection_name=${collection.name},
        owner_id=null, owner_name=null, credential=${credential}, token_prefix=${safePrefix}, revision=${randomUUID()}, updated_at=now() where guild_id=${row.guild_id}`
    }
  })
}
