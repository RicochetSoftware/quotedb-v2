// Dev-only seed: an admin and a regular user with a few quotes. Safe to re-run.
import { eq } from 'drizzle-orm'
import { hashPassword } from '../lib/passwords'
import { createDb } from './client'
import { quotes, users } from './schema'

const url = process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL is required')
if (process.env.NODE_ENV === 'production') throw new Error('Refusing to seed a production database')

const { db, close } = createDb(url, { max: 1 })
const password = 'quotedb-dev-password'

async function upsertUser(
  email: string,
  name: string,
  role: 'USER' | 'SUPER_ADMIN',
  externalId: number,
) {
  const [existing] = await db.select().from(users).where(eq(users.email, email))
  if (existing) return existing
  const [created] = await db
    .insert(users)
    .values({ email, name, role, externalId, passwordHash: await hashPassword(password) })
    .returning()
  if (!created) throw new Error(`failed to create ${email}`)
  return created
}

const admin = await upsertUser('admin@quotedb.local', 'Elmu Kelmu', 'SUPER_ADMIN', 1)
const izaro = await upsertUser('izaro@quotedb.local', 'Izaro', 'USER', 2)

const [anyQuote] = await db.select().from(quotes).limit(1)
if (!anyQuote) {
  await db.insert(quotes).values([
    {
      userId: admin.id,
      quote: 'I will finish the quote db one day',
      author: 'Elmu',
      createdAt: new Date('2023-06-01'),
    },
    { userId: admin.id, quote: 'It works on my machine', author: 'Every developer' },
    { userId: izaro.id, quote: 'Kaixo mundua', author: 'Izaro' },
    { userId: izaro.id, quote: 'Coffee first, then quotes', author: 'Izaro' },
  ])
}

console.log(`Seeded. Sign in as admin@quotedb.local or izaro@quotedb.local with "${password}".`)
await close()
