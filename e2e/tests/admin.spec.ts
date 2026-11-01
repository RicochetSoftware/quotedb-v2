import { expect, test } from '@playwright/test'
import { ADMIN, ADMIN_URL, PASSWORD, USER } from '../fixtures'

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
