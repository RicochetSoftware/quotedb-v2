export function required(name: string) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}

export function readEnv() {
  const key = Buffer.from(required('BOT_ENCRYPTION_KEY'), 'hex')
  if (key.length !== 32 || !/^[a-f\d]{64}$/i.test(required('BOT_ENCRYPTION_KEY'))) {
    throw new Error('BOT_ENCRYPTION_KEY must be 64 hexadecimal characters')
  }
  const guildId = required('DISCORD_GUILD_ID')
  if (!/^\d{17,20}$/.test(guildId)) throw new Error('Invalid DISCORD_GUILD_ID')
  const apiUrl = new URL(required('QUOTEDB_API_URL'))
  const publicUrl = new URL(required('QUOTEDB_PUBLIC_URL'))
  for (const url of [apiUrl, publicUrl]) {
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
      throw new Error('QuoteDB URLs must be HTTP(S) URLs without credentials')
    }
  }
  return {
    token: required('DISCORD_BOT_TOKEN'),
    guildId,
    key,
    databaseUrl: required('BOT_DATABASE_URL'),
    apiUrl: apiUrl.toString().replace(/\/$/, ''),
    publicUrl: publicUrl.toString(),
  }
}
export type Env = ReturnType<typeof readEnv>
