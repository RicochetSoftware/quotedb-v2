import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url')
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

export function safeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'hex')
  const bb = Buffer.from(b, 'hex')
  return ab.length === bb.length && timingSafeEqual(ab, bb)
}

const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'

export function base62Encode(bytes: Uint8Array): string {
  let n = BigInt(`0x${Buffer.from(bytes).toString('hex') || '0'}`)
  let out = ''
  while (n > 0n) {
    out = BASE62[Number(n % 62n)] + out
    n /= 62n
  }
  return out || '0'
}

export function base62Decode(value: string, byteLength: number): Buffer | null {
  let n = 0n
  for (const ch of value) {
    const i = BASE62.indexOf(ch)
    if (i < 0) return null
    n = n * 62n + BigInt(i)
  }
  const hex = n.toString(16).padStart(byteLength * 2, '0')
  if (hex.length > byteLength * 2) return null
  return Buffer.from(hex, 'hex')
}

export function randomBase62(bytes = 32): string {
  return base62Encode(randomBytes(bytes))
}

export function uuidToBase62(uuid: string): string {
  return base62Encode(Buffer.from(uuid.replaceAll('-', ''), 'hex'))
}

export function base62ToUuid(value: string): string | null {
  const buf = base62Decode(value, 16)
  if (!buf) return null
  const h = buf.toString('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}
