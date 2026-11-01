import { LoginBody, TokenCreateBody } from '@quotedb/shared'
import { describe, expect, it } from 'vitest'
import { typeboxResolver } from '../src/lib/typebox-resolver'

const run = (resolver: ReturnType<typeof typeboxResolver>, values: Record<string, unknown>) =>
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
})
