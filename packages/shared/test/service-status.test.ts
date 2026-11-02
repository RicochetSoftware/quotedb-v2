import { describe, expect, it } from 'vitest'
import { serviceNotice } from '../src/service-status'

const now = 1000000
const component = (name: string, status: string, lastCheck = now) => ({
  component: name,
  status,
  lastCheck,
})
describe('service notices', () => {
  it('names all confirmed outages and slow services', () => {
    expect(
      serviceNotice({ components: [component('api', 'down'), component('bot', 'degraded')] }, now),
    ).toBe('API is unavailable; Discord bot is experiencing degraded performance.')
  })
  it('does not confuse missing monitoring, maintenance or stale observations with downtime', () => {
    for (const data of [
      null,
      {},
      { components: null },
      {
        components: [
          null,
          component('unknown', 'down'),
          component('web', 'operational'),
          component('api', 'unknown'),
          component('bot', 'maintenance'),
          component('site', 'down', now - 180001),
        ],
      },
    ]) {
      expect(serviceNotice(data, now)).toBeNull()
    }
  })
  it('still reports a fresh outage when another component is stale', () => {
    expect(
      serviceNotice({ components: [component('api', 'down'), component('site', 'down', 1)] }, now),
    ).toBe('API is unavailable.')
  })
  it('clears the notice on recovery', () => {
    expect(serviceNotice({ components: [component('api', 'operational')] }, now)).toBeNull()
  })
})
