import { isAdminRole, type Role, type StatusFilter } from '@quotedb/shared'
import type { QueryClient } from '@tanstack/react-query'
import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  redirect,
} from '@tanstack/react-router'
import { meQuery, queryClient } from './api'
import { AdminLayout, NotFound } from './components/layout'
import { DashboardPage } from './routes/dashboard'
import { ForbiddenPage } from './routes/forbidden'
import { LoginPage } from './routes/login'
import { QuoteDetailPage } from './routes/quote-detail'
import { QuotesPage } from './routes/quotes'
import { UserDetailPage } from './routes/user-detail'
import { UserNewPage } from './routes/user-new'
import { UsersPage } from './routes/users'

const str = (v: unknown) => (typeof v === 'string' && v.length > 0 ? v : undefined)
const page = (v: unknown) => {
  const n = Number(v)
  return Number.isInteger(n) && n > 1 ? n : undefined
}
const status = (v: unknown): StatusFilter | undefined =>
  v === 'deleted' || v === 'all' ? v : undefined
const role = (v: unknown): Role | undefined =>
  v === 'USER' || v === 'ADMIN' || v === 'SUPER_ADMIN' ? v : undefined

/** Drop undefined keys so URLs stay clean. */
function compact<T extends Record<string, unknown>>(obj: T): T {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as T
}

const rootRoute = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  notFoundComponent: NotFound,
})

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  validateSearch: (s): { redirect?: string } => {
    const r = str(s.redirect)
    return r?.startsWith('/') && !r.startsWith('//') ? { redirect: r } : {}
  },
  component: LoginPage,
})

const forbiddenRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/forbidden',
  component: ForbiddenPage,
})

/** Every page below needs a signed-in ADMIN or SUPER_ADMIN. */
const authedRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'authed',
  component: AdminLayout,
  beforeLoad: async ({ context, location }) => {
    const me = await context.queryClient.ensureQueryData(meQuery)
    if (!me) throw redirect({ to: '/login', search: { redirect: location.href } })
    if (!isAdminRole(me.role)) throw redirect({ to: '/forbidden' })
    return { me }
  },
})

const dashboardRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/',
  component: DashboardPage,
})

export interface UsersSearch {
  q?: string
  role?: Role
  status?: StatusFilter
  page?: number
}
const usersRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/users',
  validateSearch: (s): UsersSearch =>
    compact({ q: str(s.q), role: role(s.role), status: status(s.status), page: page(s.page) }),
  component: UsersPage,
})
const userNewRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/users/new',
  component: UserNewPage,
})
const userDetailRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/users/$id',
  component: UserDetailPage,
})

export interface QuotesSearch {
  user_id?: string
  author?: string
  q?: string
  from?: string
  to?: string
  status?: StatusFilter
  page?: number
}
const quotesRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/quotes',
  validateSearch: (s): QuotesSearch =>
    compact({
      user_id: str(s.user_id),
      author: str(s.author),
      q: str(s.q),
      from: str(s.from),
      to: str(s.to),
      status: status(s.status),
      page: page(s.page),
    }),
  component: QuotesPage,
})
const quoteDetailRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/quotes/$id',
  component: QuoteDetailPage,
})

const routeTree = rootRoute.addChildren([
  loginRoute,
  forbiddenRoute,
  authedRoute.addChildren([
    dashboardRoute,
    usersRoute,
    userNewRoute,
    userDetailRoute,
    quotesRoute,
    quoteDetailRoute,
  ]),
])

export const router = createRouter({
  routeTree,
  context: { queryClient },
  defaultPreload: 'intent',
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
