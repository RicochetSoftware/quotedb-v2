import { ApiError, createApiClient, type Me } from '@quotedb/shared'
import { QueryClient, queryOptions } from '@tanstack/react-query'

export const api = createApiClient({ baseUrl: import.meta.env.VITE_API_URL ?? '' })

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: (count, error) => !(error instanceof ApiError && error.status < 500) && count < 2,
    },
  },
})

/** The signed-in user, or null. A 401 is an answer here, not an error. */
export const meQuery = queryOptions({
  queryKey: ['me'],
  queryFn: async (): Promise<Me | null> => {
    try {
      return await api.me()
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return null
      throw err
    }
  },
  staleTime: 5 * 60_000,
})

export const quotesQuery = queryOptions({
  queryKey: ['quotes'],
  queryFn: () => api.quotes.list({ max: 1000 }),
})

export const tokensQuery = queryOptions({
  queryKey: ['tokens'],
  queryFn: () => api.tokens.list(),
})

export const sessionsQuery = queryOptions({
  queryKey: ['sessions'],
  queryFn: () => api.auth.sessions(),
})

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Something went wrong'
}
