import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  Skeleton,
} from '@quotedb/ui'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { api } from '../api'
import { PageHeader } from '../components/layout'

function Stat({ label, value, sub }: { label: string; value: number | undefined; sub?: string }) {
  return (
    <Card className="gap-2 py-4">
      <CardHeader className="px-4">
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-3xl tabular-nums" data-testid={`stat-${label}`}>
          {value ?? '–'}
        </CardTitle>
      </CardHeader>
      {sub && <CardContent className="px-4 text-xs text-muted-foreground">{sub}</CardContent>}
    </Card>
  )
}

export function DashboardPage() {
  const stats = useQuery({ queryKey: ['admin', 'stats'], queryFn: () => api.admin.stats() })
  const s = stats.data
  return (
    <>
      <PageHeader title="Dashboard" />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat
          label="Users"
          value={s?.users.total}
          sub={s ? `${s.users.admins} admins · ${s.users.deleted} deleted` : undefined}
        />
        <Stat
          label="Quotes"
          value={s?.quotes.total}
          sub={s ? `${s.quotes.deleted} deleted` : undefined}
        />
        <Stat label="Added last 7 days" value={s?.quotes.last_7_days} />
        <Stat
          label="Deleted"
          value={s ? s.users.deleted + s.quotes.deleted : undefined}
          sub="users + quotes, restorable"
        />
      </div>
      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Recently added</CardTitle>
        </CardHeader>
        <CardContent>
          {stats.isPending ? (
            <Skeleton className="h-24" />
          ) : s?.recent_quotes.length ? (
            <ul className="divide-y">
              {s.recent_quotes.map((q) => (
                <li key={q.id} className="py-3">
                  <Link to="/quotes/$id" params={{ id: q.id }} className="hover:underline">
                    “{q.quote}”
                  </Link>
                  <div className="text-sm text-muted-foreground">
                    — {q.author} · {q.date} · {q.collection.name}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState>No quotes yet.</EmptyState>
          )}
        </CardContent>
      </Card>
    </>
  )
}
