import { describe, expect, it, vi } from 'vitest'
import { ApiError, createApiClient } from '../src/client'

describe('server and browser API clients', () => {
  it('isolates Bearer credentials and keeps browser requests unchanged', async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response('{"quotes":[]}'))
    const server = createApiClient({
      baseUrl: 'http://api.test',
      bearerToken: 'secret-a',
      fetch: transport,
      timeoutMs: 100,
    })
    await server.quotes.list({ q: 'a & b', max: 5, cursor: 'cursor' })
    expect(transport.mock.calls[0]?.[0].toString()).toContain('q=a+%26+b')
    expect(transport.mock.calls[0]?.[1]).toMatchObject({
      credentials: 'omit',
      headers: { authorization: 'Bearer secret-a' },
      signal: expect.any(AbortSignal),
    })
    transport.mockResolvedValue(new Response('{"quotes":[]}'))
    await createApiClient({ baseUrl: 'http://api.test', fetch: transport }).public.izaro()
    expect(transport.mock.calls[1]?.[1]).toMatchObject({ credentials: 'include', headers: {} })
  })
  it('passes errors through with status and preserves JSON content type', async () => {
    const transport = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('{"message":"Denied"}', { status: 403 }))
    const client = createApiClient({
      baseUrl: 'http://api.test',
      bearerToken: 'secret-b',
      fetch: transport,
    })
    await expect(client.quotes.create({ quote: 'hello', author: 'Ada' })).rejects.toBeInstanceOf(
      ApiError,
    )
    expect(transport.mock.calls[0]?.[1]?.headers).toEqual({
      'content-type': 'application/json',
      authorization: 'Bearer secret-b',
    })
  })
})
