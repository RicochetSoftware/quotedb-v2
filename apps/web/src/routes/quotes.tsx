import { type Quote, QuoteCreateBody } from '@quotedb/shared'
import {
  Button,
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Field,
  Input,
  Skeleton,
  Textarea,
  toast,
  typeboxResolver,
} from '@quotedb/ui'
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { PencilIcon, PlusIcon, SearchIcon, Trash2Icon } from 'lucide-react'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { api, errorMessage } from '../api'
import { useCollection } from '../components/collections'
import { QuoteText } from '../components/quote-card'

export function QuotesPage() {
  const { collection } = useCollection()
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<Quote | 'new' | null>(null)
  const [deleting, setDeleting] = useState<Quote | null>(null)
  const quotes = useInfiniteQuery({
    queryKey: ['quotes', collection?.id, search],
    enabled: !!collection,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      api.quotes.list({
        collection_id: collection?.id,
        max: 50,
        q: search || undefined,
        cursor: pageParam,
      }),
    getNextPageParam: (page) => page.next_cursor,
  })
  const filtered = quotes.data?.pages.flatMap((page) => page.quotes) ?? []
  const canWrite = !!collection && collection.role !== 'viewer'

  const remove = useMutation({
    mutationFn: (id: string) => api.quotes.remove(id),
    onSuccess: () => {
      toast.success('Quote deleted')
      return queryClient.invalidateQueries({ queryKey: ['quotes'] })
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  return (
    <section className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">
          {collection?.kind === 'personal' ? 'Your quotes' : (collection?.name ?? 'Quotes')}
        </h1>
        <Button disabled={!canWrite} onClick={() => setEditing('new')}>
          <PlusIcon /> Add quote
        </Button>
      </div>
      <div className="relative">
        <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          placeholder="Search quotes or authors…"
          aria-label="Search quotes"
          className="pl-9"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {quotes.isPending ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-16" />
          ))}
        </div>
      ) : quotes.isError ? (
        <EmptyState>Could not load quotes: {errorMessage(quotes.error)}</EmptyState>
      ) : filtered.length === 0 ? (
        <EmptyState>
          {search ? 'No quotes match your search.' : 'No quotes yet. Add the first one.'}
        </EmptyState>
      ) : (
        <ul className="divide-y rounded-lg border">
          {filtered.map((quote) => (
            <li key={quote.id} className="px-4 py-4">
              <QuoteText
                quote={quote.quote}
                author={quote.author}
                meta={
                  <span>
                    · {quote.date} · {quote.source}
                  </span>
                }
                actions={
                  <>
                    <Button
                      variant="ghost"
                      size="icon"
                      disabled={!canWrite}
                      aria-label="Edit quote"
                      onClick={() => setEditing(quote)}
                    >
                      <PencilIcon />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      disabled={!canWrite}
                      aria-label="Delete quote"
                      onClick={() => setDeleting(quote)}
                    >
                      <Trash2Icon />
                    </Button>
                  </>
                }
              />
            </li>
          ))}
        </ul>
      )}
      {quotes.data && (
        <p className="text-sm text-muted-foreground">
          {filtered.length} {filtered.length === 1 ? 'quote' : 'quotes'} loaded
        </p>
      )}

      {quotes.hasNextPage && (
        <Button
          variant="outline"
          disabled={quotes.isFetchingNextPage}
          onClick={() => void quotes.fetchNextPage()}
        >
          Load more
        </Button>
      )}
      <QuoteDialog collectionId={collection?.id} quote={editing} onClose={() => setEditing(null)} />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Delete this quote?"
        description={deleting ? `“${deleting.quote}” — ${deleting.author}` : ''}
        confirmLabel="Delete"
        destructive
        onConfirm={() => deleting && remove.mutate(deleting.id)}
      />
    </section>
  )
}

function QuoteDialog({
  quote,
  onClose,
  collectionId,
}: {
  quote: Quote | 'new' | null
  onClose: () => void
  collectionId?: string
}) {
  const queryClient = useQueryClient()
  const isNew = quote === 'new'
  const existing = quote && quote !== 'new' ? quote : null
  const form = useForm<QuoteCreateBody>({
    resolver: typeboxResolver(QuoteCreateBody),
    values: existing
      ? { quote: existing.quote, author: existing.author, date: existing.date }
      : { quote: '', author: '', date: '' },
  })
  const { errors, isSubmitting } = form.formState

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      if (existing) await api.quotes.update(existing.id, values)
      else {
        if (!collectionId) return
        await api.quotes.create({ ...values, collection_id: collectionId })
      }
      toast.success(existing ? 'Quote updated' : 'Quote added')
      await queryClient.invalidateQueries({ queryKey: ['quotes'] })
      form.reset()
      onClose()
    } catch (err) {
      toast.error(errorMessage(err))
    }
  })

  return (
    <Dialog open={quote !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isNew ? 'Add a quote' : 'Edit quote'}</DialogTitle>
          <DialogDescription>Who said what, and (optionally) when.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="grid gap-4" noValidate>
          <Field id="quote" label="Quote" error={errors.quote?.message}>
            <Textarea
              id="quote"
              autoFocus
              aria-invalid={!!errors.quote}
              {...form.register('quote')}
            />
          </Field>
          <Field id="author" label="Author" error={errors.author?.message}>
            <Input id="author" aria-invalid={!!errors.author} {...form.register('author')} />
          </Field>
          <Field id="date" label="Date" hint="Leave empty for today." error={errors.date?.message}>
            <Input id="date" type="date" {...form.register('date')} />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isNew ? 'Add quote' : 'Save'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
