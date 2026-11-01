import Type from 'typebox'

/**
 * Back-compat shim for v1 consumers (MIGRATION.md §3.4, §4.2). Removed in the v2 release.
 * `:id` may be a UUID or the legacy integer id (resolved through `users.external_id`).
 */
export const LegacyUserParams = Type.Object({
  id: Type.String({ minLength: 1, maxLength: 64 }),
})

export const LegacyQuotesQuery = Type.Object({
  max_quotes: Type.Integer({ minimum: 1, maximum: 1000 }),
})

export const LegacyQuote = Type.Object({
  id: Type.String(),
  quote: Type.String(),
  author: Type.String(),
  date: Type.String(),
})

export const LegacyQuoteList = Type.Object({ quotes: Type.Array(LegacyQuote) })

export type LegacyQuoteList = Type.Static<typeof LegacyQuoteList>
