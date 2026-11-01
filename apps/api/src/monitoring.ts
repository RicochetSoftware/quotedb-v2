import { createHash, timingSafeEqual } from 'node:crypto'
import { sql } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { createRemoteJWKSet, importSPKI, jwtVerify } from 'jose'
import type { Env } from './env'

export async function monitorVerifier(env: Env) {
  const local = env.NODE_ENV !== 'production' && env.ADMIN_DEV_PUBLIC_KEY
  const issuer = local
    ? 'http://quotedb.local/access'
    : `https://${env.CF_ACCESS_TEAM}.cloudflareaccess.com`
  const keys = local
    ? await importSPKI(local.replaceAll('\\n', '\n'), 'RS256')
    : createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`))
  return async (assertion: string, secret: string) => {
    if (!env.ADMIN_MONITOR_AUD || !env.ADMIN_MONITOR_CLIENT_ID || !env.ADMIN_MONITOR_SECRET)
      throw new Error('Not configured')
    const hash = (s: string) => createHash('sha256').update(s).digest()
    if (!timingSafeEqual(hash(secret), hash(env.ADMIN_MONITOR_SECRET)))
      throw new Error('Invalid credential')
    const { payload } = await jwtVerify(assertion, keys, {
      issuer,
      audience: env.ADMIN_MONITOR_AUD,
      algorithms: ['RS256'],
      requiredClaims: ['exp', 'iat', 'sub'],
    })
    if (payload.common_name !== env.ADMIN_MONITOR_CLIENT_ID)
      throw new Error('Wrong service identity')
  }
}
export async function registerMonitoring(app: FastifyInstance, env: Env) {
  const verify = await monitorVerifier(env)
  app.get(
    '/_monitor/health',
    { schema: { hide: true }, config: { rateLimit: false } },
    async (request, reply) => {
      reply.header('cache-control', 'no-store')
      const assertion = request.headers['cf-access-jwt-assertion']
      const secret = request.headers['x-monitor-secret']
      try {
        if (typeof assertion !== 'string' || typeof secret !== 'string')
          throw new Error('Missing credential')
        await verify(assertion, secret)
      } catch {
        return reply.code(401).send({ ok: false })
      }
      try {
        await app.ctx.db.execute(sql`select 1`)
        // Fixed Docker-only endpoint: never derived from request headers or parameters.
        const signal = AbortSignal.timeout(2500)
        const shell = await fetch('http://caddy:8091/index.html', { signal, redirect: 'error' })
        if (!shell.ok) throw new Error('shell')
        const html = await shell.text()
        const asset = html.match(/(?:src|href)=["'](\/assets\/[^"']+\.(?:js|css))["']/)?.[1]
        if (!html.toLowerCase().includes('quotedb') || !asset) throw new Error('asset')
        const response = await fetch(`http://caddy:8091${asset}`, { signal, redirect: 'error' })
        const content = await response.text()
        if (!response.ok || !content.trim() || /^\s*<!doctype/i.test(content))
          throw new Error('asset')
        return { ok: true, asset: true }
      } catch {
        return reply.code(503).send({ ok: false, asset: false })
      }
    },
  )
}
