import { ROLES, SCOPES } from '@quotedb/shared'
import { sql } from 'drizzle-orm'
import {
  check,
  customType,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'

/** Case-insensitive text; the extension is created in the first migration. */
const citext = customType<{ data: string }>({ dataType: () => 'citext' })

const tz = () => timestamp({ withTimezone: true })
const createdAt = () => tz().notNull().defaultNow()
const updatedAt = () =>
  tz()
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date())

export const PASSWORD_ALGOS = ['argon2id', 'bcrypt-legacy'] as const

export const users = pgTable(
  'users',
  {
    id: uuid().primaryKey().defaultRandom(),
    email: citext().notNull().unique(),
    name: text().notNull(),
    /** argon2id (`$argon2id$…`) or a v1 bcrypt hash (`$2y$…`). Null for invited users until they set one. */
    passwordHash: text(),
    passwordAlgo: text({ enum: PASSWORD_ALGOS }).notNull().default('argon2id'),
    role: text({ enum: ROLES }).notNull().default('USER'),
    /** Legacy MySQL id (MIGRATION.md §4.2). */
    externalId: integer().unique(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: tz(),
  },
  (t) => [
    check('users_role_check', sql`${t.role} in ('USER', 'ADMIN', 'SUPER_ADMIN')`),
    check('users_password_algo_check', sql`${t.passwordAlgo} in ('argon2id', 'bcrypt-legacy')`),
  ],
)

export const quotes = pgTable(
  'quotes',
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    quote: text().notNull(),
    author: text().notNull(),
    externalId: integer().unique(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: tz(),
  },
  (t) => [
    index('quotes_author_idx').on(t.author),
    index('quotes_user_created_idx')
      .on(t.userId, t.createdAt.desc())
      .where(sql`${t.deletedAt} is null`),
  ],
)

export const sessions = pgTable(
  'sessions',
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** sha256 of the opaque token in the cookie. */
    tokenHash: text().notNull().unique(),
    expiresAt: tz().notNull(),
    createdAt: createdAt(),
    lastSeenAt: tz(),
    userAgent: text(),
    ip: text(),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
)

export const RESET_PURPOSES = ['reset', 'invite'] as const

export const passwordResetTokens = pgTable(
  'password_reset_tokens',
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** sha256 of the token sent by email. */
    tokenHash: text().notNull().unique(),
    /** `invite` links are sent when an admin creates a user; they live longer than resets. */
    purpose: text({ enum: RESET_PURPOSES }).notNull().default('reset'),
    expiresAt: tz().notNull(),
    consumedAt: tz(),
    createdAt: createdAt(),
  },
  (t) => [index('password_reset_tokens_user_idx').on(t.userId)],
)

export const apiTokens = pgTable(
  'api_tokens',
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    /** `qdb_live_<id>` — safe to show in UI and logs. */
    prefix: text().notNull(),
    /** sha256 of the secret part; the secret is shown once on creation. */
    tokenHash: text().notNull().unique(),
    scopes: text({ enum: SCOPES }).array().notNull().default(sql`'{}'::text[]`),
    expiresAt: tz(),
    lastUsedAt: tz(),
    lastUsedIp: text(),
    createdAt: createdAt(),
    revokedAt: tz(),
  },
  (t) => [index('api_tokens_user_idx').on(t.userId)],
)

export type User = typeof users.$inferSelect
export type QuoteRow = typeof quotes.$inferSelect
export type ApiTokenRow = typeof apiTokens.$inferSelect
