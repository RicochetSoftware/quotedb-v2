import { afterEach, expect, it, vi } from 'vitest'
import { setupTestApp } from './helpers'

const secret = 'monitor-secret-32-characters-or-more'
const ctx = setupTestApp({
  ADMIN_MONITOR_AUD: 'test-monitor',
  ADMIN_MONITOR_CLIENT_ID: 'monitor-client',
  ADMIN_MONITOR_SECRET: secret,
})
afterEach(() => vi.unstubAllGlobals())
it('denies anonymous, human tokens, wrong credentials and other service identities', async () => {
  expect((await ctx.app.inject('/_monitor/health')).statusCode).toBe(401)
  for (const claims of [{}, { aud: 'test-monitor', common_name: 'other-client' }]) {
    const jwt = await ctx.adminAssertion('admin@example.com', claims)
    const response = await ctx.app.inject({
      url: '/_monitor/health',
      headers: { 'cf-access-jwt-assertion': jwt, 'x-monitor-secret': secret },
    })
    expect(response.statusCode).toBe(401)
  }
})
it('returns only readiness, verifies the build, and never authorizes admin operations', async () => {
  const jwt = await ctx.adminAssertion('service@example.com', {
    aud: 'test-monitor',
    common_name: 'monitor-client',
  })
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValueOnce(
        new Response('<title>QuoteDB</title><script src="/assets/app.js"></script>'),
      )
      .mockResolvedValueOnce(new Response('console.log("build")')),
  )
  const headers = { 'cf-access-jwt-assertion': jwt, 'x-monitor-secret': secret }
  expect((await ctx.app.inject({ url: '/_monitor/health', headers })).json()).toEqual({
    ok: true,
    asset: true,
  })
  expect((await ctx.app.inject({ url: '/api/v1/admin/me', headers })).statusCode).toBe(401)
  expect(
    (
      await ctx.app.inject({
        url: '/_monitor/health',
        headers: { ...headers, 'x-monitor-secret': 'wrong' },
      })
    ).statusCode,
  ).toBe(401)
})
it('fails closed when the internal build is unavailable', async () => {
  const jwt = await ctx.adminAssertion('service@example.com', {
    aud: 'test-monitor',
    common_name: 'monitor-client',
  })
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('private infrastructure error')))
  const response = await ctx.app.inject({
    url: '/_monitor/health',
    headers: { 'cf-access-jwt-assertion': jwt, 'x-monitor-secret': secret },
  })
  expect(response.statusCode).toBe(503)
  expect(response.json()).toEqual({ ok: false, asset: false })
})
it('normalizes metrics route labels and exposes no public metrics route', async () => {
  await ctx.app.inject('/not-a-real-route/private-quote-id')
  const metrics = await ctx.app.metrics.metrics()
  expect(metrics).toContain('route="unmatched"')
  expect(metrics).not.toContain('private-quote-id')
  expect((await ctx.app.inject('/metrics')).statusCode).toBe(404)
})
