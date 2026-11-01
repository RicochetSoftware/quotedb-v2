import { ROLES, SCOPES } from '@quotedb/shared'
import { sql } from 'drizzle-orm'
import {
  check,
  customType,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
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

export const users = pgTable(
  'users',
  {
    id: uuid().primaryKey().defaultRandom(),
    email: citext().notNull().unique(),
    name: text().notNull(),
    role: text({ enum: ROLES }).notNull().default('USER'),
    /** Legacy MySQL id (MIGRATION.md §4.2). */
    externalId: integer().unique(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: tz(),
  },
  (t) => [check('users_role_check', sql`${t.role} in ('USER', 'ADMIN', 'SUPER_ADMIN')`)],
)

export const collections = pgTable(
  'collections',
  {
    id: uuid().primaryKey().defaultRandom(),
    name: text().notNull(),
    kind: text({ enum: ['personal', 'shared'] }).notNull(),
    personalOwnerId: uuid()
      .references(() => users.id, { onDelete: 'restrict' })
      .unique(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check(
      'collections_kind_check',
      sql`(${t.kind} = 'personal' and ${t.personalOwnerId} is not null) or (${t.kind} = 'shared' and ${t.personalOwnerId} is null)`,
    ),
  ],
)

export const collectionMembers = pgTable(
  'collection_members',
  {
    collectionId: uuid()
      .notNull()
      .references(() => collections.id, { onDelete: 'cascade' }),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    role: text({ enum: ['owner', 'admin', 'member', 'viewer'] }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.collectionId, t.userId] }),
    check(
      'collection_members_role_check',
      sql`${t.role} in ('owner', 'admin', 'member', 'viewer')`,
    ),
    uniqueIndex('collection_one_owner_idx').on(t.collectionId).where(sql`${t.role} = 'owner'`),
    index('collection_members_user_idx').on(t.userId),
  ],
)

export const quotes = pgTable(
  'quotes',
  {
    id: uuid().primaryKey().defaultRandom(),
    collectionId: uuid()
      .notNull()
      .references(() => collections.id, { onDelete: 'restrict' }),
    // Legacy SQL column retained for migration compatibility; attribution only, never ownership.
    createdByUserId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    source: text({ enum: ['web', 'api', 'discord'] })
      .notNull()
      .default('web'),
    discordGuildId: text(),
    discordSubmitterId: text(),
    discordMessageId: text(),
    discordAuthorId: text(),
    quote: text().notNull(),
    author: text().notNull(),
    externalId: integer().unique(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: tz(),
  },
  (t) => [
    index('quotes_author_idx').on(t.author),
    index('quotes_collection_created_idx')
      .on(t.collectionId, t.createdAt.desc(), t.id.desc())
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

export const apiTokens = pgTable(
  'api_tokens',
  {
    id: uuid().primaryKey().defaultRandom(),
    kind: text({ enum: ['personal', 'collection'] })
      .notNull()
      .default('personal'),
    collectionId: uuid()
      .notNull()
      .references(() => collections.id, { onDelete: 'restrict' }),
    userId: uuid().references(() => users.id, { onDelete: 'set null' }),
    issuedByUserId: uuid().references(() => users.id, { onDelete: 'set null' }),
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
  (t) => [
    index('api_tokens_user_idx').on(t.userId),
    index('api_tokens_collection_idx').on(t.collectionId),
    check('api_tokens_kind_check', sql`${t.kind} in ('personal', 'collection')`),
  ],
)

export type User = typeof users.$inferSelect
export type QuoteRow = typeof quotes.$inferSelect
export type ApiTokenRow = typeof apiTokens.$inferSelect

export type CollectionRow = typeof collections.$inferSelect

/** Short-lived email challenges. Plain codes never enter the database. */
export const loginChallenges = pgTable(
  'login_challenges',
  {
    id: uuid().primaryKey(),
    email: text().notNull(),
    userId: uuid().references(() => users.id, { onDelete: 'cascade' }),
    codeDigest: text().notNull(),
    expiresAt: tz().notNull(),
    attempts: integer().notNull().default(0),
    consumedAt: tz(),
    createdAt: createdAt(),
  },
  (t) => [index('login_challenges_email_idx').on(t.email)],
)

/** Fixed-window budgets shared by every API process, including after restarts. */
export const authBudgets = pgTable('auth_budgets', {
  key: text().primaryKey(),
  startedAt: tz().notNull(),
  count: integer().notNull(),
})
