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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { PencilIcon, PlusIcon, SearchIcon, Trash2Icon } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { api, errorMessage, meQuery, quotesQuery } from '../api'
import { QuoteText } from '../components/quote-card'

export function QuotesPage() {
  const { data: me } = useQuery(meQuery)
  const quotes = useQuery(quotesQuery)
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<Quote | 'new' | null>(null)
  const [deleting, setDeleting] = useState<Quote | null>(null)

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase()
    const all = quotes.data?.quotes ?? []
    if (!needle) return all
    return all.filter(
      (q) => q.quote.toLowerCase().includes(needle) || q.author.toLowerCase().includes(needle),
    )
  }, [quotes.data, search])

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
        <h1 className="text-2xl font-semibold tracking-tight">Your quotes</h1>
        <Button onClick={() => setEditing('new')}>
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
                    · {quote.date} · added by {me?.name}
                  </span>
                }
                actions={
                  <>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Edit quote"
                      onClick={() => setEditing(quote)}
                    >
                      <PencilIcon />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
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
          {filtered.length} of {quotes.data.quotes.length} quotes
        </p>
      )}

      <QuoteDialog quote={editing} onClose={() => setEditing(null)} />
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

function QuoteDialog({ quote, onClose }: { quote: Quote | 'new' | null; onClose: () => void }) {
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
      else await api.quotes.create(values)
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
