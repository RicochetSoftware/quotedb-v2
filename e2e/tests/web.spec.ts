import { expect, test } from '@playwright/test'
import { PASSWORD, USER, WEB_URL } from '../fixtures'

test('web: log in, add a quote, find it, mint an API token', async ({ page }) => {
  await page.goto(`${WEB_URL}/quotes`)
  // Protected page bounces to login and comes back afterwards.
  await expect(page).toHaveURL(/\/login\?redirect=/)
  await page.getByLabel('Email').fill(USER.email)
  await page.getByLabel('Password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Log in' }).click()
  await expect(page.getByRole('heading', { name: 'Your quotes' })).toBeVisible()

  await page.getByRole('button', { name: 'Add quote' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Quote').fill('Simplicity is prerequisite for reliability')
  await dialog.getByLabel('Author').fill('Dijkstra')
  await dialog.getByRole('button', { name: 'Add quote' }).click()
  await expect(page.getByText('Simplicity is prerequisite for reliability')).toBeVisible()

  await page.getByLabel('Search quotes').fill('dijkstra')
  await expect(page.getByText('1 of 1 quotes')).toBeVisible()

  await page.getByRole('link', { name: 'Random' }).click()
  await expect(page.getByText('Simplicity is prerequisite for reliability')).toBeVisible()

  await page.goto(`${WEB_URL}/settings/tokens`)
  await page.getByRole('button', { name: 'New token' }).click()
  await page.getByLabel('Name').fill('e2e-script')
  await page.getByRole('button', { name: 'Create token' }).click()
  await expect(page.getByText("This is the only time you'll see this token")).toBeVisible()
  const token = await page.getByTestId('new-token').textContent()
  expect(token).toMatch(/^qdb_test_/)
  await page.getByRole('button', { name: "I've saved it" }).click()
  await expect(page.getByRole('cell', { name: 'e2e-script' })).toBeVisible()
  await page.screenshot({ path: 'test-results/web-tokens.png', fullPage: true })

  // The token works against the API as this user.
  const res = await page.request.get(`${WEB_URL}/api/v1/quotes`, {
    headers: { authorization: `Bearer ${token}` },
  })
  expect(res.status()).toBe(200)
  expect((await res.json()).quotes).toHaveLength(1)
})
