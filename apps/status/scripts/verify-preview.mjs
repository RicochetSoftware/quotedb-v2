import assert from 'node:assert/strict'

const root = process.env.PREVIEW_URL
const token = process.env.PREVIEW_SECRET
if (!root || !token)
  throw new Error('Set PREVIEW_URL and PREVIEW_SECRET for the disposable fixture deployment')
const snapshot = () => fetch(`${root}/api/status?t=${crypto.randomUUID()}`).then((r) => r.json())
const previous = await snapshot()
const at =
  Math.max(
    Math.floor(Date.now() / 60000) * 60000,
    ...previous.components.map((c) => c.lastCheck ?? 0),
  ) + 60000
for (const [i, mode] of [
  ...Array(3).fill('healthy'),
  ...Array(3).fill('mixed'),
  ...Array(3).fill('healthy'),
  ...Array(2).fill('all-down'),
  ...Array(3).fill('healthy'),
].entries()) {
  const response = await fetch(`${root}/run`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ at: at + i * 60000, mode }),
  })
  assert.equal(response.status, 204)
  const data = await snapshot()
  const states = Object.fromEntries(data.components.map((c) => [c.component, c.status]))
  console.log(i, mode, states)
  if ([2, 8, 13].includes(i)) assert(Object.values(states).every((s) => s === 'operational'))
  if (i === 5) {
    assert.equal(states.site, 'down')
    assert.equal(states.web, 'degraded')
  }
  if (i === 10) assert(Object.values(states).every((s) => s === 'down'))
}
console.log('Preview incident and recovery assertions passed.')
