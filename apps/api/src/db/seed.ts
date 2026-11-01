// Dev-only seed: an admin and a regular user with a few quotes. Safe to re-run.
import { eq } from 'drizzle-orm'
import { personalCollection } from '../modules/collections/access'
import { createDb } from './client'
import { quotes, users } from './schema'

const url = process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL is required')
if (process.env.NODE_ENV === 'production') throw new Error('Refusing to seed a production database')

const { db, close } = createDb(url, { max: 1 })

async function upsertUser(
  email: string,
  name: string,
  role: 'USER' | 'SUPER_ADMIN',
  externalId: number,
) {
  const [existing] = await db.select().from(users).where(eq(users.email, email))
  if (existing) return existing
  const [created] = await db.insert(users).values({ email, name, role, externalId }).returning()
  if (!created) throw new Error(`failed to create ${email}`)
  return created
}

const admin = await upsertUser('admin@quotedb.local', 'Elmu Kelmu', 'SUPER_ADMIN', 1)
const izaro = await upsertUser('izaro@quotedb.local', 'Izaro', 'USER', 2)

const adminCollection = await personalCollection(db, admin.id)
const izaroCollection = await personalCollection(db, izaro.id)

const [anyQuote] = await db.select().from(quotes).limit(1)
if (!anyQuote) {
  await db.insert(quotes).values([
    {
      createdByUserId: admin.id,
      collectionId: adminCollection.id,
      quote: 'I will finish the quote db one day',
      author: 'Elmu',
      createdAt: new Date('2023-06-01'),
    },
    {
      createdByUserId: admin.id,
      collectionId: adminCollection.id,
      quote: 'It works on my machine',
      author: 'Every developer',
    },
    {
      createdByUserId: izaro.id,
      collectionId: izaroCollection.id,
      quote: 'Kaixo mundua',
      author: 'Izaro',
    },
    {
      createdByUserId: izaro.id,
      collectionId: izaroCollection.id,
      quote: 'Coffee first, then quotes',
      author: 'Izaro',
    },
  ])
}

console.log(
  `Seeded. Sign in as admin@quotedb.local or izaro@quotedb.local using an email code (Mailpit); configure the local admin signer with node scripts/admin-dev.mjs.`,
)
await close()
