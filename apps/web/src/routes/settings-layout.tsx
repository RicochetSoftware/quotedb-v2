import { Link, Outlet } from '@tanstack/react-router'

export function SettingsLayout() {
  const tab =
    'rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground'
  const active = { className: 'bg-muted text-foreground font-medium' }
  return (
    <section className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
      <nav className="flex gap-1" aria-label="Settings sections">
        <Link to="/settings/account" className={tab} activeProps={active}>
          Account
        </Link>
        <Link to="/settings/tokens" className={tab} activeProps={active}>
          API tokens
        </Link>
      </nav>
      <Outlet />
    </section>
  )
}
