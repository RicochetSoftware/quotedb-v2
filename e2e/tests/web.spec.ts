import { expect, test } from '@playwright/test'
import { PASSWORD, USER, WEB_URL } from '../fixtures'

test('web: log in, add a quote, find it, mint an API token', async ({ page, request }) => {
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
  await expect(page.getByText('1 quote loaded')).toBeVisible()

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
  const res = await request.get(`${WEB_URL}/api/v1/quotes`, {
    headers: { authorization: `Bearer ${token}` },
  })
  expect(res.status()).toBe(200)
  expect((await res.json()).quotes).toHaveLength(1)
})

test('web: create a shared collection, switch quotes, and issue a collection token', async ({
  page,
  request,
}) => {
  await page.goto(`${WEB_URL}/login`)
  await page.getByLabel('Email').fill(USER.email)
  await page.getByLabel('Password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Log in' }).click()
  await page.getByRole('link', { name: 'Manage collections' }).click()
  const personalId = await page.getByLabel('Collection', { exact: true }).inputValue()
  await page.getByLabel('Collection name').fill('E2E Discord server')
  await page.getByRole('button', { name: 'Create collection', exact: true }).click()
  await expect(page.getByText('shared collection · Your role: owner')).toBeVisible()
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue('E2E Discord server')
  const collectionId = await page.getByLabel('Collection', { exact: true }).inputValue()
  expect(collectionId).not.toBe(personalId)
  await page.getByRole('button', { name: 'Create integration token' }).click()
  await expect(page.getByTestId('new-token')).toBeVisible()
  const token = await page.getByTestId('new-token').textContent()
  await page.getByRole('button', { name: "I've saved it" }).click()
  await page.getByRole('link', { name: 'Quotes', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'E2E Discord server' })).toBeVisible()
  await page.getByRole('button', { name: 'Add quote' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Quote', { exact: true }).fill('Shared server memory')
  await dialog.getByLabel('Author').fill('Someone on Discord')
  await dialog.getByRole('button', { name: 'Add quote' }).click()
  await expect(page.getByText('Shared server memory')).toBeVisible()
  await page.getByLabel('Collection', { exact: true }).selectOption(personalId)
  await expect(page.getByRole('heading', { name: 'Your quotes' })).toBeVisible()
  await expect(page.getByText('Shared server memory')).toHaveCount(0)
  await page.getByLabel('Collection', { exact: true }).selectOption(collectionId)
  await page.reload()
  await expect(page.getByText('Shared server memory')).toBeVisible()
  const res = await request.get(`${WEB_URL}/api/v1/quotes`, {
    headers: { authorization: `Bearer ${token}` },
  })
  expect(res.status()).toBe(200)
  expect((await res.json()).quotes).toEqual([
    expect.objectContaining({ quote: 'Shared server memory', collection_id: collectionId }),
  ])
  await page.screenshot({ path: 'test-results/web-collections.png', fullPage: true })
})
