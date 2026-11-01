import { fileURLToPath } from 'node:url'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { createDb } from './db/client'

/** Folder of drizzle-kit SQL migrations; `../drizzle` from both `src/` and `dist/`. */
export const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url))

export async function runMigrations(databaseUrl: string) {
  const { db, close } = createDb(databaseUrl, { max: 1 })
  try {
    await migrate(db, { migrationsFolder })
  } finally {
    await close()
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is required')
  await runMigrations(url)
  console.log('migrations applied')
}
