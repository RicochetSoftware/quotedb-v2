import { Button } from '@quotedb/ui'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { meQuery } from '../api'

export function HomePage() {
  const { data: me } = useQuery(meQuery)
  return (
    <section className="flex flex-col items-center gap-6 py-20 text-center">
      <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">Elmu Quote Database</h1>
      <p className="text-lg text-muted-foreground">“I will finish the quote db one day” — Elmu</p>
      <div className="flex flex-wrap justify-center gap-2">
        <Button asChild>
          <Link to="/quotes">View database</Link>
        </Button>
        {me ? (
          <>
            <Button variant="outline" asChild>
              <Link to="/random">Random quote</Link>
            </Button>
            <Button variant="outline" asChild>
              <Link to="/settings/tokens">Manage API keys</Link>
            </Button>
          </>
        ) : (
          <Button variant="outline" asChild>
            <Link to="/login">Log in</Link>
          </Button>
        )}
      </div>
    </section>
  )
}
