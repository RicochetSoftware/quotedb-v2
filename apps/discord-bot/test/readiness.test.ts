import { afterEach, expect, it, vi } from 'vitest'
import { readinessChecker, startHeartbeat } from '../src/readiness'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})
it('shares in-flight readiness and reports missing latency explicitly', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"ok":true}')))
  const check = readinessChecker({
    database: async () => {},
    apiUrl: 'http://api',
    discord: () => true,
    latency: () => -1,
  })
  const a = check(),
    b = check()
  expect(a).toBe(b)
  expect(await a).toEqual({ ready: true, db: true, api: true, discord: true, latency: null })
})
it('contains outbound failures and stops future heartbeat work on shutdown', async () => {
  vi.useFakeTimers()
  const fetcher = vi.fn().mockRejectedValue(new Error('offline'))
  vi.stubGlobal('fetch', fetcher)
  const check = vi
    .fn()
    .mockResolvedValue({ ready: true, db: true, api: true, discord: true, latency: 10 })
  const stop = startHeartbeat(check, () => {}, 'https://status/heartbeat', 's'.repeat(32))
  await vi.advanceTimersByTimeAsync(30000)
  expect(check).toHaveBeenCalledTimes(2)
  stop()
  await vi.advanceTimersByTimeAsync(60000)
  expect(check).toHaveBeenCalledTimes(2)
})
