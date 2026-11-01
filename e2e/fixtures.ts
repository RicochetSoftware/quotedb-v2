export const ADMIN_DB_URL =
  process.env.E2E_ADMIN_DATABASE_URL ?? 'postgres://quotedb:quotedb@localhost:5432/postgres'
export const E2E_DB = 'quotedb_e2e'
export const E2E_DB_URL = ADMIN_DB_URL.replace(/\/[^/]*$/, `/${E2E_DB}`)

export const API_PORT = 3100
export const WEB_PORT = 5190
export const ADMIN_PORT = 5191
export const WEB_URL = `http://localhost:${WEB_PORT}`
export const ADMIN_URL = `http://localhost:${ADMIN_PORT}`

export const PASSWORD = 'e2e-password-long-enough'
export const USER = { email: 'e2e-user@quotedb.local', name: 'E2E User' }
export const ADMIN = { email: 'e2e-admin@quotedb.local', name: 'E2E Admin' }
