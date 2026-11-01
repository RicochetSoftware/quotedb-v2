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

  await page.getByRole('link', { name: 'Users' }).click()
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
  await page.getByLabel('Search quotes').fill('Bulk test')
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
