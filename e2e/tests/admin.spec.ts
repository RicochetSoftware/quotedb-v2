import { expect, test } from '@playwright/test'
import { ADMIN, ADMIN_URL, API_PORT, PASSWORD, USER } from '../fixtures'

test('admin: log in, see the dashboard, edit a user', async ({ page }) => {
  await page.goto(ADMIN_URL)
  await expect(page).toHaveURL(/\/login/)
  await page.getByLabel('Email').fill(ADMIN.email)
  await page.getByLabel('Password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
  await expect(page.getByTestId('stat-Users')).toHaveText('2')
  await page.screenshot({ path: 'test-results/admin-dashboard.png', fullPage: true })

  await page.getByRole('link', { name: 'Collections', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Collections', exact: true })).toBeVisible()
  await page.getByLabel('Search collections').fill(ADMIN.name)
  await page.getByLabel('Collection type').selectOption('personal')
  await page.reload()
  await expect(page.getByLabel('Search collections')).toHaveValue(ADMIN.name)
  await page.getByRole('link', { name: `View quotes in ${ADMIN.name}'s quotes` }).click()
  await expect(page).toHaveURL(/collection_id=/)
  await expect(page.getByRole('heading', { name: 'Quotes', exact: true })).toBeVisible()

  await page.getByRole('link', { name: 'Users' }).click()
  await page.getByLabel('Rows per page').selectOption('100')
  await expect(page).toHaveURL(/page_size=100/)
  await page.reload()
  await expect(page.getByLabel('Rows per page')).toHaveValue('100')
  await page.getByRole('link', { name: USER.name }).click()
  await page.getByLabel('Name').fill('Renamed E2E User')
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByText('Saved')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Renamed E2E User' })).toBeVisible()
})

test('admin: a regular user is turned away', async ({ page }) => {
  await page.goto(`${ADMIN_URL}/login`)
  await page.getByLabel('Email').fill(USER.email)
  await page.getByLabel('Password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { name: 'No admin access' })).toBeVisible()
})

test('admin: select quotes, cancel, bulk delete, and restore', async ({ page }) => {
  await page.goto(`${ADMIN_URL}/login`)
  await page.getByLabel('Email').fill(ADMIN.email)
  await page.getByLabel('Password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()

  const ids: string[] = []
  for (const quote of ['Bulk test first', 'Bulk test second', 'Bulk test keep']) {
    const res = await page.request.post(`http://localhost:${API_PORT}/api/v1/quotes`, {
      headers: { origin: ADMIN_URL },
      data: { quote, author: 'Bulk test' },
    })
    expect(res.ok()).toBeTruthy()
    ids.push((await res.json()).id)
  }
  await page.getByRole('link', { name: 'Quotes', exact: true }).click()
  await page.getByLabel('Rows per page').selectOption('50')
  await expect(page).toHaveURL(/page_size=50/)
  await page.evaluate(() => document.documentElement.classList.add('dark'))
  await expect(page.getByLabel('Status', { exact: true })).toHaveCSS('color-scheme', 'dark')
  const optionColors = await page
    .getByLabel('Status', { exact: true })
    .locator('option')
    .first()
    .evaluate((option) => {
      const styles = getComputedStyle(option)
      return { background: styles.backgroundColor, foreground: styles.color }
    })
  expect(optionColors.background).not.toBe(optionColors.foreground)
  expect(optionColors.background).not.toBe('rgba(0, 0, 0, 0)')
  await page.getByLabel('Search quotes').fill('Bulk test')
  await expect(page).toHaveURL((url) => url.searchParams.get('q') === 'Bulk test')
  await expect(page.getByRole('link', { name: 'Bulk test first', exact: true })).toBeVisible()
  await page.getByRole('checkbox', { name: 'Select all active quotes on this page' }).check()
  await expect(page.getByText('3 selected on this page')).toBeVisible()
  await page.getByRole('checkbox', { name: 'Select quote: Bulk test keep', exact: true }).uncheck()
  await expect(
    page.getByRole('checkbox', { name: 'Select all active quotes on this page' }),
  ).toHaveAttribute('data-state', 'indeterminate')
  await page.getByRole('button', { name: 'Delete selected' }).click()
  await expect(page.getByRole('alertdialog')).toContainText('Delete 2 selected quotes?')
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(page.getByRole('link', { name: 'Bulk test first', exact: true })).toBeVisible()

  // One failed request must not hide successful deletions or clear the failed selection.
  await page.route(`**/api/v1/admin/quotes/${ids[1]}`, async (route) => {
    if (route.request().method() === 'DELETE') {
      await route.fulfill({ status: 500, json: { message: 'Temporary test failure' } })
    } else {
      await route.continue()
    }
  })
  await page.getByRole('button', { name: 'Delete selected' }).click()
  await page.getByRole('button', { name: 'Delete quotes', exact: true }).click()
  await expect(page.getByRole('link', { name: 'Bulk test first', exact: true })).toHaveCount(0)
  await expect(page.getByText('1 selected on this page')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Bulk test keep', exact: true })).toBeVisible()
  await page.unroute(`**/api/v1/admin/quotes/${ids[1]}`)
  await page.getByRole('button', { name: 'Delete selected' }).click()
  await page.getByRole('button', { name: 'Delete quotes', exact: true }).click()
  await expect(page.getByRole('link', { name: 'Bulk test second', exact: true })).toHaveCount(0)

  await page.getByRole('checkbox', { name: 'Select quote: Bulk test keep', exact: true }).check()
  await page.getByLabel('Status', { exact: true }).selectOption('deleted')
  await expect(page.getByRole('button', { name: 'Delete selected' })).toHaveCount(0)
  await expect(
    page.getByRole('checkbox', { name: 'Select quote: Bulk test first', exact: true }),
  ).toBeDisabled()
  await page.getByRole('link', { name: 'Bulk test first', exact: true }).click()
  await page.getByRole('button', { name: 'Restore', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Restore', exact: true })).toHaveCount(0)
})

test('admin: convert another user’s collection and manage its members and owner', async ({
  page,
}) => {
  await page.goto(`${ADMIN_URL}/login`)
  await page.getByLabel('Email').fill(ADMIN.email)
  await page.getByLabel('Password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
  const collectionOwner = { name: 'Collection Owner', email: 'collection-owner@e2e.local' }
  const response = await page.request.post(`http://localhost:${API_PORT}/api/v1/admin/users`, {
    headers: { origin: ADMIN_URL },
    data: { ...collectionOwner, password: PASSWORD },
  })
  expect(response.status()).toBe(201)
  const collection = await response.json()
  await page.goto(`${ADMIN_URL}/collections/${collection.id}`)
  await page.getByLabel('Name', { exact: true }).fill('Managed server')
  await page.getByRole('button', { name: 'Save name' }).click()
  await expect(page.getByRole('heading', { name: 'Managed server', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Convert to shared' }).click()
  await page.getByRole('button', { name: 'Confirm', exact: true }).click()
  await expect(page.getByLabel('Existing account email')).toBeVisible()
  await page.getByLabel('Existing account email').fill(ADMIN.email)
  await page.getByLabel('Role', { exact: true }).selectOption('viewer')
  await page.getByRole('button', { name: 'Add or update member' }).click()
  await page.getByLabel(`Role for ${ADMIN.email}`).selectOption('admin')
  await expect(page.getByLabel(`Role for ${ADMIN.email}`)).toHaveValue('admin')
  const adminRow = page.getByRole('row').filter({ hasText: ADMIN.email })
  await adminRow.getByRole('button', { name: 'Make owner' }).click()
  await page.getByRole('button', { name: 'Confirm', exact: true }).click()
  await expect(adminRow.getByText('Owner', { exact: true })).toBeVisible()
  const formerOwner = page.getByRole('row').filter({ hasText: collectionOwner.email })
  await expect(formerOwner.getByLabel(`Role for ${collectionOwner.email}`)).toHaveValue('admin')
  await formerOwner.getByRole('button', { name: 'Remove', exact: true }).click()
  await page.getByRole('button', { name: 'Confirm', exact: true }).click()
  await expect(formerOwner).toHaveCount(0)
})
