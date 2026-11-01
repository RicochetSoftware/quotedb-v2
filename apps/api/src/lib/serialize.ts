import type { AdminQuote, AdminUser, ApiToken, CollectionSummary, Me, Quote } from '@quotedb/shared'
import type { ApiTokenRow, QuoteRow, User } from '../db/schema'

const iso = (d: Date) => d.toISOString()
const isoOrNull = (d: Date | null) => (d ? d.toISOString() : null)

export function toQuote(row: QuoteRow): Quote {
  return {
    id: row.id,
    collection_id: row.collectionId,
    created_by_user_id: row.createdByUserId,
    source: row.source,
    quote: row.quote,
    author: row.author,
    date: iso(row.createdAt).slice(0, 10),
    created_at: iso(row.createdAt),
    updated_at: iso(row.updatedAt),
  }
}

export function toAdminQuote(
  row: QuoteRow,
  user: Pick<User, 'id' | 'name' | 'email'> | null,
  collection: CollectionSummary,
): AdminQuote {
  return {
    ...toQuote(row),
    external_id: row.externalId,
    deleted_at: isoOrNull(row.deletedAt),
    user: user ? { id: user.id, name: user.name, email: user.email } : null,
    collection,
  }
}

export function toMe(user: User): Me {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    created_at: iso(user.createdAt),
  }
}

export function toAdminUser(user: User, quoteCount: number): AdminUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    external_id: user.externalId,
    quote_count: quoteCount,
    created_at: iso(user.createdAt),
    updated_at: iso(user.updatedAt),
    deleted_at: isoOrNull(user.deletedAt),
  }
}

export function toApiToken(row: ApiTokenRow): ApiToken {
  return {
    kind: row.kind,
    collection_id: row.collectionId,
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    scopes: row.scopes,
    expires_at: isoOrNull(row.expiresAt),
    last_used_at: isoOrNull(row.lastUsedAt),
    created_at: iso(row.createdAt),
  }
}

/** `2024-01-31` → midnight UTC that day; full timestamps are kept as given. */
export function parseBackdate(value: string): Date {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00.000Z`) : new Date(value)
}

/** Escape LIKE wildcards so user input matches literally. */
export function likeContains(value: string): string {
  return `%${value.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
}
