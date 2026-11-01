// Disposable nonproduction harness. Never used by either production entrypoint.

import type { Env } from '../src/env'
import { authorized } from '../src/ingestion'
import monitor, { evaluate } from '../src/monitor'
import publicWorker, { publishSnapshot } from '../src/public'
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url)
    if (url.pathname === '/run') {
      if (!(await authorized(request, env.OPERATOR_SECRET)))
        return new Response(null, { status: 401 })
      const { at, mode } = (await request.json()) as { at: number; mode: string }
      const root = 'https://quotedb-probe-fixture.elmukelmuz.workers.dev'
      const failed = mode === 'all-down'
      const targets = {
        ...env,
        WEB_URL: `${root}/${mode === 'timeout' ? 'timeout' : failed ? 'failed' : mode === 'mixed' ? 'slow' : 'healthy'}/`,
        SITE_URL: `${root}/${mode === 'timeout' ? 'timeout' : failed || mode === 'mixed' ? 'failed' : 'healthy'}/`,
        API_URL: `${root}/${mode === 'timeout' ? 'timeout' : failed ? 'failed' : 'healthy'}`,
        ADMIN_URL: `${root}/${mode === 'timeout' ? 'timeout' : failed ? 'failed' : 'healthy'}/admin`,
        ACCESS_CLIENT_ID: 'fixture',
        ACCESS_CLIENT_SECRET: 'fixture',
        ADMIN_MONITOR_SECRET: 'fixture',
      }
      await env.DB.prepare(
        `INSERT OR REPLACE INTO bot_heartbeats VALUES(1,'fixture',1,'fixture',?,?)`,
      )
        .bind(
          at,
          JSON.stringify({ ready: !failed, api: !failed, db: true, discord: true, latency: 20 }),
        )
        .run()
      const usage = { reads: 0, writes: 0 }
      const measured = {
        ...targets,
        OTLP_URL: 'https://example.invalid/disabled-preview-export',
        DB: new Proxy(env.DB, {
          get(db, property) {
            if (property === 'batch')
              return async (statements: D1PreparedStatement[]) => {
                const results = await db.batch(statements)
                for (const result of results) {
                  usage.reads += result.meta.rows_read
                  usage.writes += result.meta.rows_written
                }
                return results
              }
            const value = Reflect.get(db, property)
            return typeof value === 'function' ? value.bind(db) : value
          },
        }),
      }
      await evaluate(measured, at)
      await publishSnapshot(env, at)
      return new Response(null, {
        status: 204,
        headers: { 'X-D1-Reads': String(usage.reads), 'X-D1-Writes': String(usage.writes) },
      })
    }
    if (url.pathname.startsWith('/failed')) return new Response('Unavailable', { status: 503 })
    if (url.pathname === '/asset.css')
      return new Response('body{color:black}', { headers: { 'content-type': 'text/css' } })
    if (url.pathname.startsWith('/healthy') || url.pathname.startsWith('/slow')) {
      if (url.pathname.startsWith('/slow'))
        await new Promise((resolve) => setTimeout(resolve, 1600))
      if (url.pathname.endsWith('/healthz')) return Response.json({ ok: true })
      if (url.pathname.endsWith('/admin')) return Response.json({ ok: true, asset: true })
      if (url.pathname.endsWith('/izaro'))
        return Response.json({
          quote: 'fixture',
          author: 'fixture',
          date: '2026-11-02',
          added_by: 'fixture',
        })
      return new Response('<title>QuoteDB</title><link href="/assets/fixture.css">', {
        headers: { 'content-type': 'text/html' },
      })
    }
    if (url.pathname === '/assets/fixture.css')
      return new Response('body{color:black}', { headers: { 'content-type': 'text/css' } })
    if (
      url.pathname === '/heartbeat' ||
      url.pathname === '/operator' ||
      url.pathname === '/maintenance'
    )
      return monitor.fetch(request, env)
    return publicWorker.fetch(request, env, ctx)
  },
}
