import type {
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
  PublicQuote,
  Quote,
  QuoteCreateBody,
  QuoteList,
  QuoteListQuery,
  QuoteUpdateBody,
  RandomQuoteQuery,
} from './schemas/quotes'
import type { TokenCreateBody, TokenCreated, TokenList } from './schemas/tokens'

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
}

export function createApiClient({ baseUrl, fetch: fetchImpl = fetch }: ApiClientOptions) {
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
      credentials: 'include',
      headers: opts.body === undefined ? {} : { 'content-type': 'application/json' },
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
    tokens: {
      list: () => request<TokenList>('GET', '/tokens'),
      create: (body: TokenCreateBody) => request<TokenCreated>('POST', '/tokens', { body }),
      revoke: (id: string) => request<void>('DELETE', `/tokens/${id}`),
    },
    public: {
      izaro: () => request<PublicQuote>('GET', '/public/izaro'),
    },
    admin: {
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
