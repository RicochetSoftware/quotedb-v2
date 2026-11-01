import Type from 'typebox'
import { Value } from 'typebox/value'

const Bool = Type.Union([Type.Boolean(), Type.Literal('true'), Type.Literal('false')])

/**
 * The app's whole env contract. Never read platform-specific variables:
 * the infra modules map their platform onto these names (MIGRATION.md §3.7).
 */
export const EnvSchema = Type.Object({
  NODE_ENV: Type.Union(
    [Type.Literal('development'), Type.Literal('test'), Type.Literal('production')],
    {
      default: 'development',
    },
  ),
  HOST: Type.String({ default: '0.0.0.0' }),
  PORT: Type.Integer({ default: 3000 }),
  LOG_LEVEL: Type.String({ default: 'info' }),
  /** Set when running behind the platform's load balancer so `request.ip` is the client's. */
  TRUST_PROXY: Type.Optional(Bool),
  DATABASE_URL: Type.String({ minLength: 1 }),
  APP_URL: Type.String({ default: 'http://localhost:3000' }),
  WEB_URL: Type.String({ default: 'http://localhost:5180' }),
  ADMIN_URL: Type.String({ default: 'http://localhost:5181' }),
  /** e.g. `.quotes.example` so app. and admin. share the session. Unset = host-only cookie. */
  COOKIE_DOMAIN: Type.Optional(Type.String()),
  COOKIE_SECRET: Type.String({ minLength: 32 }),
  MAIL_FROM: Type.String({ default: 'QuoteDB <no-reply@localhost>' }),
  /** Used when RESEND_API_KEY is not set. Mailpit in dev: smtp://localhost:1025 */
  SMTP_URL: Type.String({ default: 'smtp://localhost:1025' }),
  RESEND_API_KEY: Type.Optional(Type.String()),
  AUTH_CODE_SECRET: Type.Optional(Type.String({ minLength: 32 })),
  AUTH_EMAIL_HOURLY_LIMIT: Type.Integer({ minimum: 1, default: 1000 }),
  CF_ACCESS_TEAM: Type.Optional(Type.String({ pattern: '^[a-z0-9-]+$' })),
  CF_ACCESS_AUD: Type.Optional(Type.String({ minLength: 1 })),
  // Explicit local signed-token setup only; never accepted in production.
  ADMIN_DEV_PUBLIC_KEY: Type.Optional(Type.String()),
  /** User whose quotes `/izaro` shows: a UUID or a legacy integer id. Unset = page disabled. */
  IZARO_USER_ID: Type.Optional(Type.String()),
  IZARO_COLLECTION_ID: Type.Optional(Type.String({ format: 'uuid' })),
})

export interface Env {
  NODE_ENV: 'development' | 'test' | 'production'
  HOST: string
  PORT: number
  LOG_LEVEL: string
  TRUST_PROXY: boolean
  DATABASE_URL: string
  APP_URL: string
  WEB_URL: string
  ADMIN_URL: string
  COOKIE_DOMAIN: string | undefined
  COOKIE_SECRET: string
  MAIL_FROM: string
  SMTP_URL: string
  RESEND_API_KEY: string | undefined
  AUTH_CODE_SECRET: string
  AUTH_EMAIL_HOURLY_LIMIT: number
  CF_ACCESS_TEAM: string | undefined
  CF_ACCESS_AUD: string | undefined
  ADMIN_DEV_PUBLIC_KEY: string | undefined
  IZARO_USER_ID: string | undefined
  IZARO_COLLECTION_ID: string | undefined
}

export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const keys = Object.keys(EnvSchema.properties)
  const picked = Object.fromEntries(
    keys.filter((k) => source[k] !== undefined && source[k] !== '').map((k) => [k, source[k]]),
  )
  const value = Value.Default(EnvSchema, Value.Convert(EnvSchema, picked))
  if (!Value.Check(EnvSchema, value)) {
    const problems = [...Value.Errors(EnvSchema, value)]
      .map((e) => `  ${e.instancePath.slice(1) || '(root)'}: ${e.message}`)
      .join('\n')
    throw new Error(`Invalid environment:\n${problems}`)
  }
  const env = value as Type.Static<typeof EnvSchema>
  if (
    env.NODE_ENV === 'production' &&
    (!env.CF_ACCESS_TEAM || !env.CF_ACCESS_AUD || !env.AUTH_CODE_SECRET || env.ADMIN_DEV_PUBLIC_KEY)
  ) {
    throw new Error(
      'Production requires CF_ACCESS_TEAM, CF_ACCESS_AUD, AUTH_CODE_SECRET and forbids ADMIN_DEV_PUBLIC_KEY',
    )
  }
  return {
    ...env,
    AUTH_CODE_SECRET: env.AUTH_CODE_SECRET ?? env.COOKIE_SECRET,
    CF_ACCESS_TEAM: env.CF_ACCESS_TEAM,
    CF_ACCESS_AUD: env.CF_ACCESS_AUD,
    ADMIN_DEV_PUBLIC_KEY: env.ADMIN_DEV_PUBLIC_KEY,
    TRUST_PROXY: String(env.TRUST_PROXY ?? 'false') === 'true',
    COOKIE_DOMAIN: env.COOKIE_DOMAIN,
    RESEND_API_KEY: env.RESEND_API_KEY,
    IZARO_USER_ID: env.IZARO_USER_ID,
    IZARO_COLLECTION_ID: env.IZARO_COLLECTION_ID,
  }
}
