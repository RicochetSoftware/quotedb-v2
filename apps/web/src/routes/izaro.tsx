import { ApiError } from '@quotedb/shared'
import { Button, EmptyState, Skeleton } from '@quotedb/ui'
import { useQuery } from '@tanstack/react-query'
import { ShuffleIcon } from 'lucide-react'
import { api } from '../api'
import { QuoteText } from '../components/quote-card'

/** Public page from v1: one random quote from the featured user. */
export function IzaroPage() {
  const random = useQuery({
    queryKey: ['izaro'],
    queryFn: () => api.public.izaro(),
    staleTime: 0,
    gcTime: 0,
    retry: false,
  })

  return (
    <section className="flex flex-col items-center gap-8 py-16">
      {random.isPending ? (
        <Skeleton className="h-24 w-full max-w-xl" />
      ) : random.data ? (
        <QuoteText
          size="large"
          quote={random.data.quote}
          author={random.data.author}
          meta={
            <span className="w-full">
              Added by {random.data.added_by} · {random.data.date}
            </span>
          }
        />
      ) : (
        <EmptyState>
          {random.error instanceof ApiError && random.error.status === 404
            ? 'Nothing to show here yet.'
            : 'Could not load a quote right now.'}
        </EmptyState>
      )}
      <Button variant="outline" onClick={() => random.refetch()} disabled={random.isFetching}>
        <ShuffleIcon /> Another one
      </Button>
    </section>
  )
}
