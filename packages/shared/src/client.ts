import type {
  AdminCollectionList,
  AdminQuote,
  AdminQuoteCreateBody,
  AdminQuoteList,
  AdminQuoteListQuery,
  AdminQuoteUpdateBody,
  AdminStats,
  AdminUser,
  AdminUserCreateBody,
  AdminUserList,
  AdminUserListQuery,
  AdminUserUpdateBody,
} from './schemas/admin'
import type {
  ChangePasswordBody,
  ForgotPasswordBody,
  LoginBody,
  Me,
  ResetPasswordBody,
  SessionList,
} from './schemas/auth'
import type {
  Collection,
  CollectionCreateBody,
  CollectionList,
  CollectionMember,
  CollectionMemberBody,
  CollectionSummary,
  CollectionUpdateBody,
} from './schemas/collections'
import type {
  PublicQuote,
  Quote,
  QuoteCreateBody,
  QuoteList,
  QuoteListQuery,
  QuoteUpdateBody,
  RandomQuoteQuery,
} from './schemas/quotes'
import type {
  CollectionTokenCreateBody,
  TokenCreateBody,
  TokenCreated,
  TokenInfo,
  TokenList,
} from './schemas/tokens'

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body: unknown,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

type Query = Record<string, string | number | boolean | undefined | null>

export interface ApiClientOptions {
  /** e.g. `https://api.quotes.example` — empty string means same origin (dev proxy). */
  baseUrl: string
  fetch?: typeof fetch
  bearerToken?: string
  timeoutMs?: number
}

export function createApiClient({
  baseUrl,
  fetch: fetchImpl = fetch,
  bearerToken,
  timeoutMs,
}: ApiClientOptions) {
  async function request<T>(
    method: string,
    path: string,
    opts: { body?: unknown; query?: Query } = {},
  ): Promise<T> {
    const url = new URL(`${baseUrl}/api/v1${path}`, globalThis.location?.origin ?? baseUrl)
    for (const [key, value] of Object.entries(opts.query ?? {})) {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.set(key, String(value))
      }
    }
    const res = await fetchImpl(url, {
      method,
      credentials: bearerToken ? 'omit' : 'include',
      ...(timeoutMs ? { signal: AbortSignal.timeout(timeoutMs) } : {}),
      headers: {
        ...(opts.body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(bearerToken ? { authorization: `Bearer ${bearerToken}` } : {}),
      },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    })
    if (res.status === 204) return undefined as T
    const text = await res.text()
    const data: unknown = text ? JSON.parse(text) : undefined
    if (!res.ok) {
      const message =
        (data as { message?: string } | undefined)?.message ?? `Request failed (${res.status})`
      throw new ApiError(res.status, message, data)
    }
    return data as T
  }

  return {
    collections: {
      list: () => request<CollectionList>('GET', '/collections'),
      create: (body: CollectionCreateBody) => request<Collection>('POST', '/collections', { body }),
      update: (id: string, body: CollectionUpdateBody) =>
        request<Collection>('PATCH', `/collections/${id}`, { body }),
      members: (id: string) =>
        request<{ members: CollectionMember[] }>('GET', `/collections/${id}/members`),
      setMember: (id: string, body: CollectionMemberBody) =>
        request<void>('PUT', `/collections/${id}/members`, { body }),
      removeMember: (id: string, userId: string) =>
        request<void>('DELETE', `/collections/${id}/members/${userId}`),
      transfer: (id: string, userId: string) =>
        request<void>('POST', `/collections/${id}/transfer`, { body: { user_id: userId } }),
      tokens: (id: string) => request<TokenList>('GET', `/collections/${id}/tokens`),
      createToken: (id: string, body: CollectionTokenCreateBody) =>
        request<TokenCreated>('POST', `/collections/${id}/tokens`, { body }),
      revokeToken: (id: string, tokenId: string) =>
        request<void>('DELETE', `/collections/${id}/tokens/${tokenId}`),
    },
    auth: {
      login: (body: LoginBody) => request<Me>('POST', '/auth/login', { body }),
      logout: () => request<void>('POST', '/auth/logout'),
      forgotPassword: (body: ForgotPasswordBody) =>
        request<{ ok: true }>('POST', '/auth/password/forgot', { body }),
      resetPassword: (body: ResetPasswordBody) =>
        request<{ ok: true }>('POST', '/auth/password/reset', { body }),
      changePassword: (body: ChangePasswordBody) =>
        request<{ ok: true }>('POST', '/auth/password/change', { body }),
      sessions: () => request<SessionList>('GET', '/auth/sessions'),
      logoutOthers: () => request<{ ok: true }>('POST', '/auth/logout-others'),
    },
    me: () => request<Me>('GET', '/me'),
    quotes: {
      list: (query: QuoteListQuery = {}) => request<QuoteList>('GET', '/quotes', { query }),
      random: (query: RandomQuoteQuery = {}) =>
        request<QuoteList>('GET', '/quotes/random', { query }),
      get: (id: string) => request<Quote>('GET', `/quotes/${id}`),
      create: (body: QuoteCreateBody) => request<Quote>('POST', '/quotes', { body }),
      update: (id: string, body: QuoteUpdateBody) =>
        request<Quote>('PATCH', `/quotes/${id}`, { body }),
      remove: (id: string) => request<void>('DELETE', `/quotes/${id}`),
    },
    tokenInfo: () => request<TokenInfo>('GET', '/token-info'),
    tokens: {
      list: () => request<TokenList>('GET', '/tokens'),
      create: (body: TokenCreateBody) => request<TokenCreated>('POST', '/tokens', { body }),
      revoke: (id: string) => request<void>('DELETE', `/tokens/${id}`),
    },
    public: {
      izaro: () => request<PublicQuote>('GET', '/public/izaro'),
    },
    admin: {
      collection: {
        get: (id: string) => request<CollectionSummary>('GET', `/admin/collections/${id}`),
        update: (id: string, body: CollectionUpdateBody) =>
          request<CollectionSummary>('PATCH', `/admin/collections/${id}`, { body }),
        members: (id: string) =>
          request<{ members: CollectionMember[] }>('GET', `/admin/collections/${id}/members`),
        setMember: (id: string, body: CollectionMemberBody) =>
          request<void>('PUT', `/admin/collections/${id}/members`, { body }),
        removeMember: (id: string, userId: string) =>
          request<void>('DELETE', `/admin/collections/${id}/members/${userId}`),
        transfer: (id: string, userId: string) =>
          request<void>('POST', `/admin/collections/${id}/transfer`, { body: { user_id: userId } }),
      },
      collections: () => request<AdminCollectionList>('GET', '/admin/collections'),
      stats: () => request<AdminStats>('GET', '/admin/stats'),
      users: {
        list: (query: AdminUserListQuery = {}) =>
          request<AdminUserList>('GET', '/admin/users', { query }),
        get: (id: string) => request<AdminUser>('GET', `/admin/users/${id}`),
        create: (body: AdminUserCreateBody) => request<AdminUser>('POST', '/admin/users', { body }),
        update: (id: string, body: AdminUserUpdateBody) =>
          request<AdminUser>('PATCH', `/admin/users/${id}`, { body }),
        remove: (id: string) => request<void>('DELETE', `/admin/users/${id}`),
        restore: (id: string) => request<AdminUser>('POST', `/admin/users/${id}/restore`),
        sendPasswordReset: (id: string) =>
          request<{ ok: true }>('POST', `/admin/users/${id}/password-reset`),
        quotes: (id: string) => request<QuoteList>('GET', `/admin/users/${id}/quotes`),
      },
      quotes: {
        list: (query: AdminQuoteListQuery = {}) =>
          request<AdminQuoteList>('GET', '/admin/quotes', { query }),
        get: (id: string) => request<AdminQuote>('GET', `/admin/quotes/${id}`),
        create: (body: AdminQuoteCreateBody) =>
          request<AdminQuote>('POST', '/admin/quotes', { body }),
        update: (id: string, body: AdminQuoteUpdateBody) =>
          request<AdminQuote>('PATCH', `/admin/quotes/${id}`, { body }),
        remove: (id: string) => request<void>('DELETE', `/admin/quotes/${id}`),
        restore: (id: string) => request<AdminQuote>('POST', `/admin/quotes/${id}/restore`),
      },
    },
  }
}

export type ApiClient = ReturnType<typeof createApiClient>
