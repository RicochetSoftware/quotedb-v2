import type { QueryClient } from '@tanstack/react-query'
import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  redirect,
} from '@tanstack/react-router'
import { meQuery, queryClient } from './api'
import { Layout, NotFound } from './components/layout'
import { CollectionsPage } from './routes/collections'
import { ForgotPasswordPage } from './routes/forgot-password'
import { HomePage } from './routes/home'
import { IzaroPage } from './routes/izaro'
import { LoginPage } from './routes/login'
import { QuotesPage } from './routes/quotes'
import { RandomPage } from './routes/random'
import { ResetPasswordPage } from './routes/reset-password'
import { AccountPage } from './routes/settings-account'
import { SettingsLayout } from './routes/settings-layout'
import { TokensPage } from './routes/settings-tokens'

/** Only same-app paths, so `?redirect=` can't bounce users to another site. */
export function safeRedirect(value: unknown): string | undefined {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//')
    ? value
    : undefined
}

const rootRoute = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: Layout,
  notFoundComponent: NotFound,
})

const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', component: HomePage })

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  validateSearch: (search): { redirect?: string } => {
    const target = safeRedirect(search.redirect)
    return target ? { redirect: target } : {}
  },
  component: LoginPage,
})

const forgotRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/forgot-password',
  component: ForgotPasswordPage,
})

const resetRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/reset-password',
  validateSearch: (search): { token?: string; invite?: boolean } => ({
    ...(typeof search.token === 'string' ? { token: search.token } : {}),
    ...(search.invite === 1 || search.invite === '1' || search.invite === true
      ? { invite: true }
      : {}),
  }),
  component: ResetPasswordPage,
})

const izaroRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/izaro',
  component: IzaroPage,
})

/** Pathless layout: everything below requires a signed-in user. */
const authedRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'authed',
  beforeLoad: async ({ context, location }) => {
    const me = await context.queryClient.ensureQueryData(meQuery)
    if (!me) throw redirect({ to: '/login', search: { redirect: location.href } })
    return { me }
  },
})

const collectionsRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/collections',
  component: CollectionsPage,
})

const quotesRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/quotes',
  component: QuotesPage,
})
const randomRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/random',
  component: RandomPage,
})

const settingsRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/settings',
  component: SettingsLayout,
})
const settingsIndexRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: '/',
  beforeLoad: () => {
    throw redirect({ to: '/settings/account' })
  },
})
const accountRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: '/account',
  component: AccountPage,
})
const tokensRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: '/tokens',
  component: TokensPage,
})

const routeTree = rootRoute.addChildren([
  indexRoute,
  loginRoute,
  forgotRoute,
  resetRoute,
  izaroRoute,
  authedRoute.addChildren([
    collectionsRoute,
    quotesRoute,
    randomRoute,
    settingsRoute.addChildren([settingsIndexRoute, accountRoute, tokensRoute]),
  ]),
])

export const router = createRouter({
  routeTree,
  context: { queryClient },
  defaultPreload: 'intent',
  scrollRestoration: true,
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
