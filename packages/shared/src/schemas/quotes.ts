import Type from 'typebox'
import { DateOrTimestamp, Timestamp, Uuid } from './common'

export const QUOTE_MAX_LENGTH = 5000
export const AUTHOR_MAX_LENGTH = 255

export const Quote = Type.Object({
  id: Uuid,
  collection_id: Uuid,
  created_by_user_id: Type.Union([Uuid, Type.Null()]),
  source: Type.Union([Type.Literal('web'), Type.Literal('api'), Type.Literal('discord')]),
  quote: Type.String(),
  author: Type.String(),
  /** Calendar date the quote was said/added (`YYYY-MM-DD`), derived from `created_at`. */
  date: Type.String({ format: 'date' }),
  created_at: Timestamp,
  updated_at: Timestamp,
})

export const QuoteList = Type.Object({
  quotes: Type.Array(Quote),
  next_cursor: Type.Optional(Type.String()),
})

export const QuoteListQuery = Type.Object({
  collection_id: Type.Optional(Uuid),
  cursor: Type.Optional(Type.String({ minLength: 1, maxLength: 512 })),
  max: Type.Optional(Type.Integer({ minimum: 1, maximum: 1000, default: 1000 })),
  author: Type.Optional(Type.String({ minLength: 1, maxLength: AUTHOR_MAX_LENGTH })),
  q: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
})

export const RandomQuoteQuery = Type.Object({
  collection_id: Type.Optional(Uuid),
  max: Type.Optional(Type.Integer({ minimum: 1, maximum: 1000, default: 1 })),
})

const quoteText = Type.String({ minLength: 1, maxLength: QUOTE_MAX_LENGTH })
const authorText = Type.String({ minLength: 1, maxLength: AUTHOR_MAX_LENGTH })

const DiscordId = Type.String({ pattern: '^[0-9]{17,20}$' })
export const QuoteCreateBody = Type.Object(
  {
    collection_id: Type.Optional(Uuid),
    discord: Type.Optional(
      Type.Object(
        {
          guild_id: DiscordId,
          submitter_id: DiscordId,
          message_id: Type.Optional(DiscordId),
          author_id: Type.Optional(DiscordId),
        },
        { additionalProperties: false },
      ),
    ),
    quote: quoteText,
    author: authorText,
    /** Optional backdate; defaults to now. */
    date: Type.Optional(DateOrTimestamp),
  },
  { additionalProperties: false },
)

export const QuoteUpdateBody = Type.Object(
  {
    quote: Type.Optional(quoteText),
    author: Type.Optional(authorText),
    date: Type.Optional(DateOrTimestamp),
  },
  { additionalProperties: false, minProperties: 1 },
)

/** Public random quote for `/izaro` — includes who added it, nothing else about the user. */
export const PublicQuote = Type.Object({
  quote: Type.String(),
  author: Type.String(),
  date: Type.String({ format: 'date' }),
  added_by: Type.String(),
})

export type Quote = Type.Static<typeof Quote>
export type QuoteList = Type.Static<typeof QuoteList>
export type QuoteListQuery = Type.Static<typeof QuoteListQuery>
export type RandomQuoteQuery = Type.Static<typeof RandomQuoteQuery>
export type QuoteCreateBody = Type.Static<typeof QuoteCreateBody>
export type QuoteUpdateBody = Type.Static<typeof QuoteUpdateBody>
export type PublicQuote = Type.Static<typeof PublicQuote>
