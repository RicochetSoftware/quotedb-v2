import { isAdminRole, type Scope } from '@quotedb/shared'
import { eq } from 'drizzle-orm'
import type { FastifyReply, FastifyRequest } from 'fastify'
import fp from 'fastify-plugin'
import { apiTokens, sessions, type User } from '../db/schema'
import { hasScope, verifyToken } from './api-token'
import { findSession, SESSION_COOKIE } from './session'

export type AuthContext =
  | { kind: 'session'; user: User; sessionId: string }
  | {
      kind: 'token'
      user: User | null
      tokenKind: 'personal' | 'collection'
      collectionId: string
      tokenId: string
      prefix: string
      scopes: Scope[]
    }

declare module 'fastify' {
  interface FastifyRequest {
    auth: AuthContext | null
  }
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])
const TOUCH_INTERVAL_MS = 60_000

/**
 * Resolves the caller from the session cookie or `Authorization: Bearer` (cookie wins if both),
 * and blocks cross-site state-changing requests by checking Origin/Referer.
 */
export const authPlugin = fp(
  async (app) => {
    const { db, env } = app.ctx
    const allowedOrigins = new Set(
      [env.WEB_URL, env.ADMIN_URL, env.APP_URL].map((u) => new URL(u).origin),
    )
    const tokenEnv = env.NODE_ENV === 'production' ? 'live' : 'test'
    const lastTouched = new Map<string, number>()

    /** Debounced, fire-and-forget bookkeeping writes (~1/min per session or token). */
    function shouldTouch(key: string): boolean {
      const now = Date.now()
      if ((lastTouched.get(key) ?? 0) > now - TOUCH_INTERVAL_MS) return false
      lastTouched.set(key, now)
      return true
    }

    function originOf(request: FastifyRequest): string | null {
      const origin = request.headers.origin
      if (origin) return origin
      const referer = request.headers.referer
      if (!referer) return null
      try {
        return new URL(referer).origin
      } catch {
        return null
      }
    }

    app.decorateRequest('auth', null)

    app.addHook('onRequest', async (request) => {
      const authHeader = request.headers.authorization
      const rawCookie = request.cookies[SESSION_COOKIE]
      const usesBearerOnly = !rawCookie && authHeader?.startsWith('Bearer ')

      if (!SAFE_METHODS.has(request.method) && !usesBearerOnly) {
        const origin = originOf(request)
        if (!origin || !allowedOrigins.has(origin)) {
          throw app.httpErrors.forbidden('Cross-site request blocked')
        }
      }

      if (rawCookie) {
        const unsigned = request.unsignCookie(rawCookie)
        if (unsigned.valid && unsigned.value) {
          const found = await findSession(db, unsigned.value)
          if (found) {
            request.auth = { kind: 'session', user: found.user, sessionId: found.sessionId }
            if (shouldTouch(`s:${found.sessionId}`)) {
              void db
                .update(sessions)
                .set({ lastSeenAt: new Date() })
                .where(eq(sessions.id, found.sessionId))
                .catch((err) => request.log.warn({ err }, 'failed to touch session'))
            }
            return
          }
        }
      }

      if (authHeader?.startsWith('Bearer ')) {
        const result = await verifyToken(db, authHeader.slice(7).trim(), tokenEnv)
        if (result === null) throw app.httpErrors.badRequest('Malformed API token')
        if (!result.ok) {
          request.log.info({ reason: result.reason }, 'API token rejected')
          throw app.httpErrors.unauthorized('Invalid API token')
        }
        const { token, user } = result
        request.auth = {
          kind: 'token',
          user,
          tokenKind: token.kind,
          collectionId: token.collectionId,
          tokenId: token.id,
          prefix: token.prefix,
          scopes: token.scopes,
        }
        if (shouldTouch(`t:${token.id}`)) {
          void db
            .update(apiTokens)
            .set({ lastUsedAt: new Date(), lastUsedIp: request.ip })
            .where(eq(apiTokens.id, token.id))
            .catch((err) => request.log.warn({ err }, 'failed to touch api token'))
        }
      }
    })

    // Token-authenticated requests are logged with the prefix only, never the secret.
    app.addHook('onResponse', async (request, reply) => {
      if (request.auth?.kind === 'token') {
        request.log.info(
          {
            token: { id: request.auth.tokenId, prefix: request.auth.prefix },
            userId: request.auth.user?.id,
            route: request.routeOptions.url,
            status: reply.statusCode,
          },
          'api token request',
        )
      }
    })
  },
  { name: 'auth', dependencies: ['@fastify/cookie', '@fastify/sensible'] },
)

type Guard = (request: FastifyRequest, reply: FastifyReply) => Promise<void>

export const requireAuth: Guard = async (request) => {
  if (!request.auth) throw request.server.httpErrors.unauthorized('Authentication required')
}

/** Session callers pass (they hold every scope); token callers need `scope`. */
export function requireScope(scope: Scope): Guard {
  return async (request, reply) => {
    await requireAuth(request, reply)
    if (request.auth?.kind === 'token' && !hasScope(request.auth.scopes, scope)) {
      throw request.server.httpErrors.forbidden(`API token is missing the "${scope}" scope`)
    }
  }
}

/** Routes tokens can never use: token management, password changes, admin. */
export const requireSession: Guard = async (request, reply) => {
  await requireAuth(request, reply)
  if (request.auth?.kind !== 'session') {
    throw request.server.httpErrors.forbidden('This endpoint requires a signed-in session')
  }
}

export const requireAdmin: Guard = async (request, reply) => {
  await requireSession(request, reply)
  if (!request.auth?.user || !isAdminRole(request.auth.user.role)) {
    throw request.server.httpErrors.forbidden('Admin role required')
  }
}

/** Narrowing helper for handlers behind a guard. */
export function authOf(request: FastifyRequest): AuthContext {
  if (!request.auth) throw request.server.httpErrors.unauthorized('Authentication required')
  return request.auth
}

/** A human account principal; collection credentials never impersonate their issuer. */
export function userOf(request: FastifyRequest): User {
  const user = authOf(request).user
  if (!user) throw request.server.httpErrors.forbidden('This endpoint requires a user account')
  return user
}
