import cookie from '@fastify/cookie'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import rateLimit from '@fastify/rate-limit'
import sensible from '@fastify/sensible'
import swagger from '@fastify/swagger'
import swaggerUi from '@fastify/swagger-ui'
import { type TypeBoxTypeProvider, TypeBoxValidatorCompiler } from '@fastify/type-provider-typebox'
import { sql } from 'drizzle-orm'
import Fastify, { type FastifyServerOptions } from 'fastify'
import { authPlugin } from './auth/plugin'
import { SESSION_COOKIE } from './auth/session'
import type { AppContext } from './context'
import type { Db } from './db/client'
import type { Env } from './env'
import { createSmtpMailer, type Mailer } from './lib/mailer'
import { adminRoutes } from './modules/admin/routes'
import { authRoutes } from './modules/auth/routes'
import { collectionRoutes } from './modules/collections/routes'
import { publicRoutes } from './modules/public/routes'
import { quoteRoutes } from './modules/quotes/routes'
import { tokenRoutes } from './modules/tokens/routes'

export interface BuildAppOptions {
  env: Env
  db: Db
  mailer?: Mailer
  logger?: FastifyServerOptions['logger']
}

/** Builds the Fastify app without listening, so tests can drive it with `app.inject()`. */
export async function buildApp(options: BuildAppOptions) {
  const { env, db } = options
  const app = Fastify({
    logger: options.logger ?? {
      level: env.LOG_LEVEL,
      redact: [
        'req.headers.authorization',
        'req.headers.cookie',
        'req.headers["cf-access-jwt-assertion"]',
        'res.headers["set-cookie"]',
      ],
    },
    trustProxy: env.TRUST_PROXY,
  }).withTypeProvider<TypeBoxTypeProvider>()
  app.setValidatorCompiler(TypeBoxValidatorCompiler)
  app.setErrorHandler((error, request, reply) => {
    const status = (error as { statusCode?: number }).statusCode ?? 500
    if (status >= 500) {
      request.log.error({ err: error }, 'Request failed')
      return reply
        .code(500)
        .send({ statusCode: 500, error: 'Internal Server Error', message: 'Internal server error' })
    }
    return reply.send(error)
  })

  const ctx: AppContext = {
    env,
    db,
    mailer: options.mailer ?? createSmtpMailer(env),
  }
  app.decorate('ctx', ctx)

  await app.register(sensible)
  // JSON API: no CSP needed; CORP same-site so app./admin. (siblings of api.) can read responses.
  await app.register(helmet, {
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: 'same-site' },
  })
  await app.register(cors, {
    origin: [env.WEB_URL, env.ADMIN_URL],
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  })
  await app.register(cookie, { secret: env.COOKIE_SECRET })
  await app.register(authPlugin)
  await app.register(rateLimit, {
    // preHandler, so the caller is already resolved: limits apply per token, per user, or per IP.
    hook: 'preHandler',
    max: 100,
    timeWindow: '1 minute',
    keyGenerator: (request) => {
      const auth = request.auth
      if (auth?.kind === 'token') return `token:${auth.tokenId}`
      if (auth?.kind === 'session' || auth?.kind === 'admin') return `user:${auth.user.id}`
      return `ip:${request.ip}`
    },
  })

  await app.register(swagger, {
    openapi: {
      info: { title: 'QuoteDB API', version: '1.0.0' },
      servers: [{ url: env.APP_URL }],
      components: {
        securitySchemes: {
          session: { type: 'apiKey', in: 'cookie', name: SESSION_COOKIE },
          cloudflareAccess: { type: 'apiKey', in: 'header', name: 'Cf-Access-Jwt-Assertion' },
          bearer: {
            type: 'http',
            scheme: 'bearer',
            description: 'Personal access token: qdb_<env>_<id>_<secret>',
          },
        },
      },
      security: [{ session: [] }, { bearer: [] }],
    },
  })
  app.addHook('onRoute', (route) => {
    if (route.url.startsWith('/api/v1/admin/'))
      route.schema = { ...route.schema, security: [{ cloudflareAccess: [] }] }
    if (route.url.startsWith('/api/v1/auth/code/')) route.schema = { ...route.schema, security: [] }
  })
  await app.register(swaggerUi, { routePrefix: '/api/documentation' })

  app.get('/healthz', { config: { rateLimit: false }, schema: { hide: true } }, async () => {
    await db.execute(sql`select 1`)
    return { ok: true }
  })

  await app.register(
    async (v1) => {
      await v1.register(authRoutes)
      await v1.register(quoteRoutes)
      await v1.register(collectionRoutes)
      await v1.register(collectionRoutes, { prefix: '/admin', siteAdmin: true })
      await v1.register(tokenRoutes)
      await v1.register(publicRoutes)
      await v1.register(adminRoutes)
    },
    { prefix: '/api/v1' },
  )

  return app
}

export type App = Awaited<ReturnType<typeof buildApp>>
