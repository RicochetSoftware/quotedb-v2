// Run with the repository Playwright installation and a static server at :8765.

import assert from 'node:assert/strict'
import { chromium } from '../../../e2e/node_modules/@playwright/test/index.mjs'

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage()
let fixture
let outage = false
await page.route('**/api/status', (route) =>
  outage ? route.fulfill({ status: 503, body: 'unavailable' }) : route.fulfill({ json: fixture }),
)
const names = ['web', 'admin', 'bot', 'api', 'site']
function data(statuses, stale = false, history = true) {
  const now = Date.now()
  const totals = {
    percent: 99.9,
    available: 86340,
    unavailable: 60,
    degraded: 0,
    unknown: 0,
    maintenance: 0,
    coverage: 1,
  }
  return {
    stale,
    generatedAt: now,
    measurementStart: now - 86400000,
    historyAt: now,
    components: names.map((component, i) => ({
      component,
      status: statuses[i],
      lastCheck: stale ? now - 240000 : now,
      history: history
        ? {
            windows: [totals, totals, totals],
            days: Array.from({ length: 90 }, (_, j) => ({
              day: now - (89 - j) * 86400000,
              ...totals,
            })),
          }
        : null,
    })),
    incidents: [],
    maintenance: [],
    notes: [],
  }
}
for (const scenario of [
  'green',
  'mixed',
  'down',
  'maintenance',
  'no-history',
  'stale',
  'database-failure',
]) {
  outage = scenario === 'database-failure'
  fixture = data(
    scenario === 'mixed'
      ? ['degraded', 'operational', 'operational', 'operational', 'down']
      : Array(5).fill(
          scenario === 'down' ? 'down' : scenario === 'maintenance' ? 'maintenance' : 'operational',
        ),
    scenario === 'stale',
    scenario !== 'no-history',
  )
  if (scenario === 'maintenance') {
    for (const component of fixture.components)
      for (const day of component.history.days) {
        day.unavailable = 0
        day.maintenance = 60
      }
    // An overrun remains red even on a day that also contains maintenance.
    fixture.components[0].history.days[89].unavailable = 60
  }
  await page.goto('http://localhost:8765')
  await page.waitForFunction(
    () => !document.querySelector('#banner').textContent.includes('Checking'),
  )
  assert.equal(await page.locator('.card').count(), 5)
  const banner = await page.locator('#banner').textContent()
  if (scenario === 'maintenance') {
    assert.equal(await page.locator('.day.maintenance').count(), 449)
    assert.equal(await page.locator('.day.down').count(), 1)
  }
  if (scenario === 'green') assert.match(banner, /All services operational/)
  if (scenario === 'mixed') {
    assert.match(banner, /Service disruption/)
    assert.equal(await page.locator('#banner li.down').count(), 1)
    assert.equal(await page.locator('#banner li.degraded').count(), 1)
  }
  if (['stale', 'database-failure'].includes(scenario))
    assert.match(banner, /Monitoring unavailable or stale/)
  if (scenario === 'mixed')
    await page.screenshot({ path: '/tmp/quotedb-status-desktop.png', fullPage: true })
}
await page.setViewportSize({ width: 390, height: 844 })
outage = false
fixture = data(['degraded', 'operational', 'operational', 'operational', 'down'])
await page.reload()
await page.waitForSelector('.card')
assert.equal(
  await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth),
  false,
)
await page.screenshot({ path: '/tmp/quotedb-status-mobile.png', fullPage: true })
await browser.close()
console.log('Seven fixture states and mobile layout passed.')
