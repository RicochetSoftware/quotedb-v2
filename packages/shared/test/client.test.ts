import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, createApiClient } from '../src/client'

afterEach(() => vi.unstubAllGlobals())

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

  it('resolves same-origin browser URLs and omits empty query parameters without dropping zero', async () => {
    vi.stubGlobal('location', { origin: 'https://quotes.example.test' })
    const transport = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ quotes: [] }))
    const client = createApiClient({ baseUrl: '', fetch: transport })
    await client.quotes.list({ q: '', max: 0, cursor: undefined })
    expect(String(transport.mock.calls[0]?.[0])).toBe(
      'https://quotes.example.test/api/v1/quotes?max=0',
    )
    expect(transport.mock.calls[0]?.[1]?.signal).toBeUndefined()
  })

  it('preserves structured validation errors for callers', async () => {
    const body = { message: 'Invalid input', fields: { quote: 'Required' } }
    const client = createApiClient({
      baseUrl: 'https://api.test',
      fetch: vi.fn<typeof fetch>().mockResolvedValue(Response.json(body, { status: 422 })),
    })
    await expect(client.quotes.create({ quote: '', author: 'Ada' })).rejects.toMatchObject({
      name: 'ApiError',
      status: 422,
      message: 'Invalid input',
      body,
    })
  })

  it.each(['', '{}'])(
    'provides a useful HTTP error when the server has no message (%s)',
    async (body) => {
      const client = createApiClient({
        baseUrl: 'https://api.test',
        fetch: vi.fn<typeof fetch>().mockResolvedValue(new Response(body, { status: 503 })),
      })
      await expect(client.me()).rejects.toMatchObject({
        status: 503,
        message: 'Request failed (503)',
      })
    },
  )

  it('accepts empty successful responses, including logout and deletion', async () => {
    const transport = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(''))
    const client = createApiClient({ baseUrl: 'https://api.test', fetch: transport })
    await expect(client.auth.logout()).resolves.toBeUndefined()
    await expect(client.quotes.remove('quote-id')).resolves.toBeUndefined()
    await expect(client.me()).resolves.toBeUndefined()
    expect(
      transport.mock.calls.map(([url, init]) => [new URL(String(url)).pathname, init?.method]),
    ).toEqual([
      ['/api/v1/auth/logout', 'POST'],
      ['/api/v1/quotes/quote-id', 'DELETE'],
      ['/api/v1/me', 'GET'],
    ])
  })

  it('propagates transport failures rather than misreporting them as HTTP errors', async () => {
    const failure = new TypeError('Network unavailable')
    const client = createApiClient({
      baseUrl: 'https://api.test',
      fetch: vi.fn<typeof fetch>().mockRejectedValue(failure),
    })
    await expect(client.me()).rejects.toBe(failure)
  })

  it('aborts a stalled request at its configured deadline', async () => {
    const client = createApiClient({
      baseUrl: 'https://api.test',
      timeoutMs: 10,
      fetch: vi.fn<typeof fetch>().mockImplementation(
        (_url, init) =>
          new Promise((_resolve, reject) => {
            const signal = init?.signal
            signal?.addEventListener('abort', () => reject(signal.reason), { once: true })
          }),
      ),
    })
    await expect(client.me()).rejects.toMatchObject({ name: 'TimeoutError' })
  })

  it('keeps collection membership and token operations scoped to their collection', async () => {
    const transport = vi
      .fn<typeof fetch>()
      .mockImplementation(async (_url, init) =>
        init?.method === 'GET'
          ? Response.json({ members: [], tokens: [] })
          : new Response(null, { status: 204 }),
      )
    const client = createApiClient({ baseUrl: 'https://api.test', fetch: transport })
    await client.collections.setMember('collection-a', {
      email: 'member@example.test',
      role: 'viewer',
    })
    await client.collections.members('collection-a')
    await client.collections.transfer('collection-a', 'new-owner')
    await client.collections.removeMember('collection-a', 'old-member')
    await client.collections.tokens('collection-a')
    await client.collections.revokeToken('collection-a', 'token-id')
    expect(
      transport.mock.calls.map(([url, init]) => [
        new URL(String(url)).pathname,
        init?.method,
        init?.body,
      ]),
    ).toEqual([
      [
        '/api/v1/collections/collection-a/members',
        'PUT',
        JSON.stringify({ email: 'member@example.test', role: 'viewer' }),
      ],
      ['/api/v1/collections/collection-a/members', 'GET', undefined],
      [
        '/api/v1/collections/collection-a/transfer',
        'POST',
        JSON.stringify({ user_id: 'new-owner' }),
      ],
      ['/api/v1/collections/collection-a/members/old-member', 'DELETE', undefined],
      ['/api/v1/collections/collection-a/tokens', 'GET', undefined],
      ['/api/v1/collections/collection-a/tokens/token-id', 'DELETE', undefined],
    ])
  })
})
