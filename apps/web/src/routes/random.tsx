import { Button, EmptyState, Skeleton } from '@quotedb/ui'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { ShuffleIcon } from 'lucide-react'
import { api, errorMessage } from '../api'
import { useCollection } from '../components/collections'
import { QuoteText } from '../components/quote-card'

export function RandomPage() {
  const { collection } = useCollection()
  const random = useQuery({
    queryKey: ['quotes', 'random', collection?.id],
    queryFn: () => api.quotes.random({ max: 1, collection_id: collection?.id }),
    enabled: !!collection,
    staleTime: 0,
    gcTime: 0,
  })
  const quote = random.data?.quotes[0]

  return (
    <section className="flex flex-col items-center gap-8 py-16">
      {random.isPending ? (
        <Skeleton className="h-24 w-full max-w-xl" />
      ) : random.isError ? (
        <EmptyState>{errorMessage(random.error)}</EmptyState>
      ) : quote ? (
        <QuoteText
          size="large"
          quote={quote.quote}
          author={quote.author}
          meta={
            <span className="w-full">
              {quote.date} · {collection?.name}
            </span>
          }
        />
      ) : (
        <EmptyState>
          No quotes yet.{' '}
          <Link to="/quotes" className="underline">
            Add your first one
          </Link>
          .
        </EmptyState>
      )}
      <Button
        variant="outline"
        onClick={() => random.refetch()}
        disabled={!collection || random.isFetching}
      >
        <ShuffleIcon /> Another one
      </Button>
    </section>
  )
}
