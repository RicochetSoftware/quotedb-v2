import postgres from 'postgres'
import { hashPassword } from '../apps/api/src/lib/passwords'
import { runMigrations } from '../apps/api/src/migrate'
import { ADMIN, ADMIN_DB_URL, E2E_DB, E2E_DB_URL, PASSWORD, USER } from './fixtures'

/**
 * Fresh database for every run: drop, create, migrate, seed one user and one admin.
 * Run from the API webServer command, because Playwright starts web servers before globalSetup.
 */
async function prepareDb() {
  const admin = postgres(ADMIN_DB_URL, { max: 1, onnotice: () => {} })
  await admin.unsafe(`drop database if exists ${E2E_DB} with (force)`)
  await admin.unsafe(`create database ${E2E_DB}`)
  await admin.end()

  await runMigrations(E2E_DB_URL)

  const db = postgres(E2E_DB_URL, { max: 1, onnotice: () => {} })
  const hash = await hashPassword(PASSWORD)
  await db`insert into users (email, name, role, password_hash) values
    (${USER.email}, ${USER.name}, 'USER', ${hash}),
    (${ADMIN.email}, ${ADMIN.name}, 'SUPER_ADMIN', ${hash})`
  await db.end()
}

await prepareDb()
