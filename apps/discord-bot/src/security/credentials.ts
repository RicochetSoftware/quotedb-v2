import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

export function encrypt(key: Buffer, guildId: string, token: string): string {
  const nonce = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, nonce)
  cipher.setAAD(Buffer.from(`quotedb-bot:v1:${guildId}`))
  const data = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()])
  return [
    '1',
    nonce.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    data.toString('base64url'),
  ].join('.')
}

export function decrypt(key: Buffer, guildId: string, value: string): string {
  const [version, nonce, tag, data] = value.split('.')
  if (version !== '1' || !nonce || !tag || !data) throw new Error('Invalid encrypted credential')
  const cipher = createDecipheriv('aes-256-gcm', key, Buffer.from(nonce, 'base64url'))
  cipher.setAAD(Buffer.from(`quotedb-bot:v1:${guildId}`))
  cipher.setAuthTag(Buffer.from(tag, 'base64url'))
  return Buffer.concat([cipher.update(Buffer.from(data, 'base64url')), cipher.final()]).toString(
    'utf8',
  )
}
