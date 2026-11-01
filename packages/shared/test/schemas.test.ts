import { Compile } from 'typebox/compile'
import { describe, expect, it } from 'vitest'
import { QuoteCreateBody, QuoteUpdateBody, SCOPES, TokenCreateBody } from '../src'

describe('shared schemas', () => {
  it('rejects user_id on quote creation (identity comes from auth)', () => {
    const check = Compile(QuoteCreateBody)
    expect(check.Check({ quote: 'q', author: 'a' })).toBe(true)
    expect(check.Check({ quote: 'q', author: 'a', user_id: 1 })).toBe(false)
  })

  it('accepts a date or a timestamp as backdate', () => {
    const check = Compile(QuoteCreateBody)
    expect(check.Check({ quote: 'q', author: 'a', date: '2024-01-31' })).toBe(true)
    expect(check.Check({ quote: 'q', author: 'a', date: '2024-01-31T10:00:00Z' })).toBe(true)
    expect(check.Check({ quote: 'q', author: 'a', date: 'yesterday' })).toBe(false)
  })

  it('requires at least one field on update', () => {
    expect(Compile(QuoteUpdateBody).Check({})).toBe(false)
  })

  it('validates token scopes against the catalog', () => {
    const check = Compile(TokenCreateBody)
    expect(check.Check({ name: 'ci', scopes: [...SCOPES] })).toBe(true)
    expect(check.Check({ name: 'ci', scopes: [] })).toBe(false)
    expect(check.Check({ name: 'ci', scopes: ['admin'] })).toBe(false)
    expect(check.Check({ name: 'ci', scopes: ['quotes:read', 'quotes:read'] })).toBe(false)
  })
})
