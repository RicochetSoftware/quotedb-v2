import { ApiError, createApiClient, type Me } from '@quotedb/shared'
import { QueryClient, queryOptions } from '@tanstack/react-query'

export const api = createApiClient({
  baseUrl: import.meta.env.VITE_ADMIN_API_URL ?? '',
  fetch: (input, init) =>
    fetch(input, { ...init, headers: { ...init?.headers, 'X-Requested-With': 'XMLHttpRequest' } }),
})
export const WEB_URL = import.meta.env.VITE_WEB_URL ?? 'http://localhost:5180'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      retry: (count, error) => !(error instanceof ApiError && error.status < 500) && count < 2,
    },
  },
})

export const meQuery = queryOptions({
  queryKey: ['me'],
  queryFn: async (): Promise<Me | null> => {
    try {
      return await api.admin.me()
    } catch (err) {
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) return null
      throw err
    }
  },
  staleTime: 5 * 60_000,
})

/** Every user, for owner pickers (admin datasets are small: ~a dozen users). */
export const allUsersQuery = queryOptions({
  queryKey: ['admin', 'users', 'all'],
  queryFn: () => api.admin.users.list({ status: 'all', page_size: 100 }),
})

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Something went wrong'
}

export const allCollectionsQuery = queryOptions({
  queryKey: ['admin', 'collections'],
  queryFn: () => api.admin.collections(),
})
