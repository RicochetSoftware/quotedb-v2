import { sign } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, type Page } from '@playwright/test'
import postgres from 'postgres'

export const ADMIN_DB_URL =
  process.env.E2E_ADMIN_DATABASE_URL ?? 'postgres://quotedb:quotedb@localhost:5432/postgres'
export const E2E_DB = 'quotedb_e2e'
export const E2E_DB_URL = ADMIN_DB_URL.replace(/\/[^/]*$/, `/${E2E_DB}`)

export const API_PORT = 3100
export const WEB_PORT = 5190
export const ADMIN_PORT = 5191
export const WEB_URL = `http://localhost:${WEB_PORT}`
export const ADMIN_URL = `http://localhost:${ADMIN_PORT}`

export const USER = { email: 'e2e-user@quotedb.local', name: 'E2E User' }
export const ADMIN = { email: 'e2e-admin@quotedb.local', name: 'E2E Admin' }

export async function adminLogin(page: Page, email = ADMIN.email) {
  const key = readFileSync(resolve('../.local/e2e-admin.pem'), 'utf8')
  const now = Math.floor(Date.now() / 1000)
  const enc = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url')
  const data = `${enc({ alg: 'RS256' })}.${enc({ iss: 'http://quotedb.local/access', aud: 'e2e-admin', sub: email, email, iat: now, exp: now + 3600 })}`
  await page.context().setExtraHTTPHeaders({
    'cf-access-jwt-assertion': `${data}.${sign('RSA-SHA256', Buffer.from(data), key).toString('base64url')}`,
  })
  await page.goto(ADMIN_URL)
}

export async function webLogin(page: Page, email = USER.email) {
  // Reset only test-database budgets between browser scenarios; the API tests cover limits.
  const db = postgres(E2E_DB_URL, { max: 1 })
  await db`delete from auth_budgets`
  await db.end()
  await page.getByLabel('Email', { exact: true }).fill(email)
  const sentAfter = Date.now() - 1000
  await page.getByRole('button', { name: 'Send sign-in code' }).click()
  await expect(page.getByLabel('Sign-in code')).toBeVisible()
  const mailpit = process.env.E2E_MAILPIT_URL ?? 'http://localhost:8025'
  let code = ''
  await expect
    .poll(async () => {
      const result = await (
        await fetch(`${mailpit}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`)
      ).json()
      const latest = result.messages?.[0]
      const id = latest && Date.parse(latest.Created) >= sentAfter ? latest.ID : undefined
      if (!id) return false
      const message = await (await fetch(`${mailpit}/api/v1/message/${id}`)).json()
      code = message.Text?.match(/\b\d{6}\b/)?.[0] ?? ''
      return !!code
    })
    .toBe(true)
  await page.getByLabel('Sign-in code').fill(code)
  await page.getByRole('button', { name: 'Verify and log in' }).click()
}
