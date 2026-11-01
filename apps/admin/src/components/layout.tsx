import { Button, ThemeToggle, toast } from '@quotedb/ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, Outlet, useNavigate } from '@tanstack/react-router'
import { LayoutDashboardIcon, QuoteIcon, ShieldIcon, UsersIcon } from 'lucide-react'
import { api, errorMessage, meQuery, WEB_URL } from '../api'

export function AdminLayout() {
  const { data: me } = useQuery(meQuery)
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  async function logout() {
    try {
      await api.auth.logout()
    } catch (err) {
      toast.error(errorMessage(err))
    }
    queryClient.clear()
    await navigate({ to: '/login' })
  }

  const link =
    'flex items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground [&_svg]:size-4'
  const active = { className: 'bg-muted text-foreground font-medium' }

  return (
    <div className="flex min-h-svh flex-col md:flex-row">
      <aside className="border-b md:w-56 md:shrink-0 md:border-r md:border-b-0">
        <div className="flex h-14 items-center gap-2 px-4 font-semibold">
          <ShieldIcon className="size-5" aria-hidden /> QuoteDB Admin
        </div>
        <nav className="flex gap-1 overflow-x-auto px-2 pb-2 md:flex-col" aria-label="Admin">
          <Link to="/" className={link} activeProps={active} activeOptions={{ exact: true }}>
            <LayoutDashboardIcon /> Dashboard
          </Link>
          <Link to="/users" className={link} activeProps={active}>
            <UsersIcon /> Users
          </Link>
          <Link to="/quotes" className={link} activeProps={active}>
            <QuoteIcon /> Quotes
          </Link>
        </nav>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center justify-end gap-2 border-b px-4">
          <span className="mr-auto truncate text-sm text-muted-foreground">
            {me?.name} · {me?.role}
          </span>
          <Button variant="ghost" size="sm" asChild>
            <a href={WEB_URL}>Open app</a>
          </Button>
          <ThemeToggle />
          <Button variant="outline" size="sm" onClick={logout}>
            Log out
          </Button>
        </header>
        <main className="flex-1 p-4 md:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}

export function NotFound() {
  return (
    <div className="py-24 text-center">
      <h1 className="text-2xl font-semibold">Not found</h1>
      <Button className="mt-6" variant="outline" asChild>
        <Link to="/">Back to dashboard</Link>
      </Button>
    </div>
  )
}

export function PageHeader({ title, actions }: { title: string; actions?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      {actions}
    </div>
  )
}

export function Pagination({
  page,
  pageSize,
  total,
  onPage,
}: {
  page: number
  pageSize: number
  total: number
  onPage: (page: number) => void
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  return (
    <div className="mt-4 flex items-center justify-between text-sm text-muted-foreground">
      <span>
        {total} total · page {page} of {pages}
      </span>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          Previous
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={page >= pages}
          onClick={() => onPage(page + 1)}
        >
          Next
        </Button>
      </div>
    </div>
  )
}
