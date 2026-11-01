import { describe, expect, it, vi } from 'vitest'
import { type ApiClient, createApiClient } from '../src/client'
import { isAdminRole } from '../src/roles'
import { isScope } from '../src/scopes'

// Public wire contracts: catch accidental route, verb, ID, or body changes in the SDK.
const collection = '11111111-1111-4111-8111-111111111111'
const user = '22222222-2222-4222-8222-222222222222'
const quote = '33333333-3333-4333-8333-333333333333'
type Contract = [string, (client: ApiClient) => Promise<unknown>, string, string, unknown?]
const contracts: Contract[] = [
  ['list collections', (c) => c.collections.list(), 'GET', '/collections'],
  [
    'create collection',
    (c) => c.collections.create({ name: 'Team' }),
    'POST',
    '/collections',
    { name: 'Team' },
  ],
  [
    'rename collection',
    (c) => c.collections.update(collection, { name: 'Team 2' }),
    'PATCH',
    `/collections/${collection}`,
    { name: 'Team 2' },
  ],
  [
    'issue collection key',
    (c) => c.collections.createToken(collection, { name: 'Bot', scopes: ['quotes:read'] }),
    'POST',
    `/collections/${collection}/tokens`,
    { name: 'Bot', scopes: ['quotes:read'] },
  ],
  [
    'request code',
    (c) => c.auth.requestCode({ email: 'ada@example.test' }),
    'POST',
    '/auth/code/request',
    { email: 'ada@example.test' },
  ],
  [
    'verify code',
    (c) => c.auth.verifyCode({ challenge_id: user, code: '123456' }),
    'POST',
    '/auth/code/verify',
    { challenge_id: user, code: '123456' },
  ],
  ['admin identity', (c) => c.admin.me(), 'GET', '/admin/me'],
  ['invite', (c) => c.admin.users.invite(user), 'POST', `/admin/users/${user}/invite`],
  ['list sessions', (c) => c.auth.sessions(), 'GET', '/auth/sessions'],
  ['logout other devices', (c) => c.auth.logoutOthers(), 'POST', '/auth/logout-others'],
  ['random quotes', (c) => c.quotes.random(), 'GET', '/quotes/random'],
  ['get quote', (c) => c.quotes.get(quote), 'GET', `/quotes/${quote}`],
  [
    'edit quote',
    (c) => c.quotes.update(quote, { author: 'Ada' }),
    'PATCH',
    `/quotes/${quote}`,
    { author: 'Ada' },
  ],
  ['token info', (c) => c.tokenInfo(), 'GET', '/token-info'],
  ['list personal keys', (c) => c.tokens.list(), 'GET', '/tokens'],
  [
    'issue personal key',
    (c) => c.tokens.create({ name: 'Script', scopes: ['profile:read'], expires_at: null }),
    'POST',
    '/tokens',
    { name: 'Script', scopes: ['profile:read'], expires_at: null },
  ],
  ['revoke personal key', (c) => c.tokens.revoke('token-id'), 'DELETE', '/tokens/token-id'],
  [
    'admin collection',
    (c) => c.admin.collection.get(collection),
    'GET',
    `/admin/collections/${collection}`,
  ],
  [
    'admin edit collection',
    (c) => c.admin.collection.update(collection, { kind: 'shared' }),
    'PATCH',
    `/admin/collections/${collection}`,
    { kind: 'shared' },
  ],
  [
    'admin members',
    (c) => c.admin.collection.members(collection),
    'GET',
    `/admin/collections/${collection}/members`,
  ],
  [
    'admin add member',
    (c) => c.admin.collection.setMember(collection, { email: 'ada@example.test', role: 'viewer' }),
    'PUT',
    `/admin/collections/${collection}/members`,
    { email: 'ada@example.test', role: 'viewer' },
  ],
  [
    'admin remove member',
    (c) => c.admin.collection.removeMember(collection, user),
    'DELETE',
    `/admin/collections/${collection}/members/${user}`,
  ],
  [
    'admin transfer',
    (c) => c.admin.collection.transfer(collection, user),
    'POST',
    `/admin/collections/${collection}/transfer`,
    { user_id: user },
  ],
  ['admin collections', (c) => c.admin.collections(), 'GET', '/admin/collections'],
  ['admin statistics', (c) => c.admin.stats(), 'GET', '/admin/stats'],
  ['admin users', (c) => c.admin.users.list(), 'GET', '/admin/users'],
  ['admin get user', (c) => c.admin.users.get(user), 'GET', `/admin/users/${user}`],
  [
    'admin invite',
    (c) => c.admin.users.create({ email: 'ada@example.test', name: 'Ada' }),
    'POST',
    '/admin/users',
    { email: 'ada@example.test', name: 'Ada' },
  ],
  [
    'admin edit user',
    (c) => c.admin.users.update(user, { role: 'ADMIN' }),
    'PATCH',
    `/admin/users/${user}`,
    { role: 'ADMIN' },
  ],
  ['admin delete user', (c) => c.admin.users.remove(user), 'DELETE', `/admin/users/${user}`],
  [
    'admin restore user',
    (c) => c.admin.users.restore(user),
    'POST',
    `/admin/users/${user}/restore`,
  ],
  [
    'admin resend invitation',
    (c) => c.admin.users.invite(user),
    'POST',
    `/admin/users/${user}/invite`,
  ],
  ['admin user quotes', (c) => c.admin.users.quotes(user), 'GET', `/admin/users/${user}/quotes`],
  ['admin quotes', (c) => c.admin.quotes.list(), 'GET', '/admin/quotes'],
  ['admin quote', (c) => c.admin.quotes.get(quote), 'GET', `/admin/quotes/${quote}`],
  [
    'admin create quote',
    (c) => c.admin.quotes.create({ quote: 'Hello', author: 'Ada', collection_id: collection }),
    'POST',
    '/admin/quotes',
    { quote: 'Hello', author: 'Ada', collection_id: collection },
  ],
  [
    'admin edit quote',
    (c) => c.admin.quotes.update(quote, { quote: 'Corrected' }),
    'PATCH',
    `/admin/quotes/${quote}`,
    { quote: 'Corrected' },
  ],
  ['admin delete quote', (c) => c.admin.quotes.remove(quote), 'DELETE', `/admin/quotes/${quote}`],
  [
    'admin restore quote',
    (c) => c.admin.quotes.restore(quote),
    'POST',
    `/admin/quotes/${quote}/restore`,
  ],
]

describe('SDK wire compatibility', () => {
  it.each(contracts)('%s', async (_name, call, method, path, body) => {
    const result = { marker: 'server response' }
    const transport = vi.fn<typeof fetch>().mockResolvedValue(Response.json(result))
    const client = createApiClient({ baseUrl: 'https://api.test', fetch: transport })
    expect(await call(client)).toEqual(result)
    expect(transport).toHaveBeenCalledOnce()
    const callArgs = transport.mock.calls[0]
    if (!callArgs) throw new Error('Expected a transport request')
    const [url, init] = callArgs
    expect(String(url)).toBe(`https://api.test/api/v1${path}`)
    expect(init?.method).toBe(method)
    expect(init?.body).toBe(body === undefined ? undefined : JSON.stringify(body))
    expect(new Headers(init?.headers).get('content-type')).toBe(
      body === undefined ? null : 'application/json',
    )
  })
})

it('recognizes only the supported roles and token scopes', () => {
  expect(isAdminRole('USER')).toBe(false)
  expect(isAdminRole('ADMIN')).toBe(true)
  expect(isAdminRole('SUPER_ADMIN')).toBe(true)
  for (const scope of ['quotes:read', 'quotes:write', 'profile:read'])
    expect(isScope(scope)).toBe(true)
  for (const scope of ['', '*', 'admin', 'QUOTES:READ']) expect(isScope(scope)).toBe(false)
})
