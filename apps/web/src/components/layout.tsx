import { isAdminRole, STATUS_URL } from '@quotedb/shared'
import { Button, ThemeToggle, toast } from '@quotedb/ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { QuoteIcon } from 'lucide-react'
import { api, errorMessage, meQuery } from '../api'
import { CollectionOutlet, CollectionPicker, CollectionProvider } from './collections'
import { ServiceNotice } from './service-notice'

const ADMIN_URL = import.meta.env.VITE_ADMIN_URL ?? 'http://localhost:5181'

export function Layout() {
  const { data: me } = useQuery(meQuery)
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  async function logout() {
    try {
      await api.auth.logout()
    } catch (err) {
      toast.error(errorMessage(err))
    }
    queryClient.setQueryData(meQuery.queryKey, null)
    queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== 'me' })
    await navigate({ to: '/' })
  }

  const navLink = 'text-sm text-muted-foreground transition-colors hover:text-foreground'
  const activeLink = { className: 'text-foreground font-medium' }

  return (
    <CollectionProvider key={me?.id ?? 'anonymous'} userId={me?.id}>
      <div className="flex min-h-svh flex-col">
        <header className="border-b">
          <div className="mx-auto flex min-h-14 max-w-4xl flex-wrap items-center gap-4 px-4 py-2">
            <Link to="/" className="flex items-center gap-2 font-semibold">
              <QuoteIcon className="size-5" aria-hidden />
              <span className="hidden sm:inline">Elmu Quote Database</span>
            </Link>
            {me && (
              <nav className="order-last flex w-full items-center gap-4 sm:order-none sm:w-auto">
                <Link to="/quotes" className={navLink} activeProps={activeLink}>
                  Quotes
                </Link>
                <Link to="/random" className={navLink} activeProps={activeLink}>
                  Random
                </Link>
                <Link to="/settings" className={navLink} activeProps={activeLink}>
                  Settings
                </Link>
                {isAdminRole(me.role) && (
                  <a href={ADMIN_URL} className={navLink}>
                    Admin
                  </a>
                )}
              </nav>
            )}
            <div className="ml-auto flex items-center gap-2">
              <a href={STATUS_URL} className={navLink}>
                Status
              </a>
              <ThemeToggle />
              {me ? (
                <Button variant="outline" size="sm" onClick={logout}>
                  Log out
                </Button>
              ) : (
                <Button size="sm" asChild>
                  <Link to="/login">Log in</Link>
                </Button>
              )}
            </div>
          </div>
        </header>
        <ServiceNotice />
        <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8">
          {me && <CollectionPicker />}
          <CollectionOutlet />
        </main>
        <footer className="py-6 text-center text-sm text-muted-foreground">
          2023- © Ricochet Software
        </footer>
      </div>
    </CollectionProvider>
  )
}

export function NotFound() {
  return (
    <div className="py-24 text-center">
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <p className="mt-2 text-muted-foreground">That page doesn't exist.</p>
      <Button className="mt-6" variant="outline" asChild>
        <Link to="/">Go home</Link>
      </Button>
    </div>
  )
}
