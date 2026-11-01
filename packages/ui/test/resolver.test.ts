import { LoginBody, TokenCreateBody } from '@quotedb/shared'
import type { FieldValues, Resolver } from 'react-hook-form'
import Type from 'typebox'
import { describe, expect, it } from 'vitest'
import { typeboxResolver } from '../src/lib/typebox-resolver'

const run = <V extends FieldValues>(resolver: Resolver<V>, values: Record<string, unknown>) =>
  resolver(values as never, undefined, { fields: {}, shouldUseNativeValidation: false })

describe('typeboxResolver', () => {
  it('passes valid values through', async () => {
    const result = await run(typeboxResolver(LoginBody), { email: 'a@b.co', password: 'x' })
    expect(result.errors).toEqual({})
    expect(result.values).toEqual({ email: 'a@b.co', password: 'x' })
  })

  it('maps errors to fields with friendly messages', async () => {
    const result = await run(typeboxResolver(LoginBody), { email: 'nope', password: '' })
    expect(result.errors).toMatchObject({
      email: { message: 'Enter a valid email address' },
      password: { message: 'Required' },
    })
  })

  it('reports array errors on the array field', async () => {
    const result = await run(typeboxResolver(TokenCreateBody), { name: 'x', scopes: [] })
    expect(result.errors).toMatchObject({ scopes: { message: 'Pick at least one' } })
  })

  it('drops blank optional fields while preserving false and zero without mutating input', async () => {
    const schema = Type.Object({
      name: Type.Optional(Type.String({ minLength: 2 })),
      enabled: Type.Boolean(),
      count: Type.Number(),
    })
    const input = { name: '', enabled: false, count: 0 }
    expect(await run(typeboxResolver(schema), input)).toEqual({
      values: { enabled: false, count: 0 },
      errors: {},
    })
    expect(input.name).toBe('')
  })

  it('shows useful length limits and rejects invalid values', async () => {
    const resolver = typeboxResolver(
      Type.Object({ name: Type.String({ minLength: 3, maxLength: 5 }) }),
    )
    expect(await run(resolver, { name: 'ab' })).toMatchObject({
      values: {},
      errors: { name: { message: 'Must be at least 3 characters' } },
    })
    expect(await run(resolver, { name: 'abcdef' })).toMatchObject({
      values: {},
      errors: { name: { message: 'Must be at most 5 characters' } },
    })
    expect(await run(resolver, { name: 'abc' })).toEqual({ values: { name: 'abc' }, errors: {} })
  })

  it('reports invalid nested values at the top-level field', async () => {
    const resolver = typeboxResolver(
      Type.Object({ settings: Type.Object({ enabled: Type.Boolean() }) }),
    )
    const result = await run(resolver, { settings: { enabled: 'yes' } })
    expect(result.values).toEqual({})
    expect(result.errors.settings).toMatchObject({ type: 'type', message: expect.any(String) })
  })
})
