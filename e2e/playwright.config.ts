import { createPublicKey, generateKeyPairSync } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig, devices } from '@playwright/test'
import { ADMIN_PORT, ADMIN_URL, API_PORT, E2E_DB_URL, WEB_PORT, WEB_URL } from './fixtures'

mkdirSync(resolve('../.local'), { recursive: true, mode: 0o700 })
const keyFile = resolve('../.local/e2e-admin.pem')
if (!existsSync(keyFile)) {
  const keys = generateKeyPairSync('rsa', { modulusLength: 2048 })
  writeFileSync(keyFile, keys.privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 })
}
const publicKey = createPublicKey(readFileSync(keyFile))
  .export({ type: 'spki', format: 'pem' })
  .toString()
const apiEnv = {
  NODE_ENV: 'test',
  PORT: String(API_PORT),
  DATABASE_URL: E2E_DB_URL,
  COOKIE_SECRET: 'e2e-cookie-secret-that-is-long-enough-to-pass',
  APP_URL: `http://localhost:${API_PORT}`,
  WEB_URL,
  ADMIN_URL,
  CF_ACCESS_AUD: 'e2e-admin',
  ADMIN_DEV_PUBLIC_KEY: publicKey,
  SMTP_URL: process.env.E2E_SMTP_URL ?? 'smtp://localhost:1025',
  LOG_LEVEL: 'warn',
}
const frontendEnv = {
  API_PROXY_TARGET: `http://localhost:${API_PORT}`,
  VITE_WEB_URL: WEB_URL,
  VITE_ADMIN_URL: ADMIN_URL,
  VITE_API_URL: '',
  VITE_ADMIN_API_URL: '',
  ADMIN_DEV_PRIVATE_KEY_FILE: '',
}

/**
 * One happy-path E2E per app (MIGRATION.md §2.7). Needs the docker compose Postgres running;
 * the API and both Vite dev servers are started here against a throwaway `quotedb_e2e` database.
 */
export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: { trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command:
        'pnpm --dir ../apps/api exec tsx ../../e2e/prepare-db.ts && pnpm --dir ../apps/api exec tsx src/index.ts',
      url: `http://localhost:${API_PORT}/healthz`,
      env: apiEnv,
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: `pnpm --dir ../apps/web exec vite --port ${WEB_PORT} --strictPort`,
      url: WEB_URL,
      env: frontendEnv,
      reuseExistingServer: false,
    },
    {
      command: `pnpm --dir ../apps/admin exec vite --port ${ADMIN_PORT} --strictPort`,
      url: ADMIN_URL,
      env: frontendEnv,
      reuseExistingServer: false,
    },
  ],
})
