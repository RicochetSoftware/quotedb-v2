import { AdminQuoteCreateBody } from '@quotedb/shared'
import {
  Badge,
  Button,
  Card,
  CardContent,
  Checkbox,
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
  NativeSelect,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
  toast,
  typeboxResolver,
} from '@quotedb/ui'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useSearch } from '@tanstack/react-router'
import { PlusIcon, TrashIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { allCollectionsQuery, api, errorMessage } from '../api'
import { PageHeader, Pagination } from '../components/layout'
import type { QuotesSearch } from '../router'

export function QuotesPage() {
  const search = useSearch({ from: '/authed/quotes' })
  const pageSize = search.page_size ?? 25
  const navigate = useNavigate({ from: '/quotes' })
  const collections = useQuery(allCollectionsQuery)
  const [q, setQ] = useState(search.q ?? '')
  const [author, setAuthor] = useState(search.author ?? '')
  const [importing, setImporting] = useState(false)
  const queryClient = useQueryClient()
  const selectionKey = JSON.stringify(search)
  const [selection, setSelection] = useState<{ key: string; ids: string[] }>({ key: '', ids: [] })
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const setSearch = (patch: Partial<QuotesSearch>) =>
    navigate({ search: (prev) => ({ ...prev, page: undefined, ...patch }), replace: true })

  useEffect(() => {
    setSelection({ key: selectionKey, ids: [] })
    setConfirmDelete(false)
  }, [selectionKey])

  useEffect(() => {
    const t = setTimeout(() => {
      if ((search.q ?? '') !== q || (search.author ?? '') !== author) {
        setSearch({ q: q || undefined, author: author || undefined })
      }
    }, 300)
    return () => clearTimeout(t)
  })

  const quotes = useQuery({
    queryKey: ['admin', 'quotes', search],
    queryFn: () => api.admin.quotes.list({ ...search, page_size: pageSize }),
    placeholderData: keepPreviousData,
  })

  // Selection belongs only to the current page and filters, never to placeholder rows.
  const selectable = quotes.isPlaceholderData
    ? []
    : (quotes.data?.quotes.filter((quote) => !quote.deleted_at).map((quote) => quote.id) ?? [])
  const selected =
    selection.key === selectionKey ? selection.ids.filter((id) => selectable.includes(id)) : []
  const select = (ids: string[]) => setSelection({ key: selectionKey, ids })

  const deleteSelected = async () => {
    if (deleting || selected.length === 0) return
    setConfirmDelete(false)
    setDeleting(true)
    const failed: string[] = []
    let failureMessage = ''
    // A page has at most 100 rows. Sequential requests avoid a burst against API rate limits.
    for (const id of selected) {
      try {
        await api.admin.quotes.remove(id)
      } catch (err) {
        failed.push(id)
        failureMessage = errorMessage(err)
      }
    }
    select(failed)
    const deleted = selected.length - failed.length
    if (deleted) toast.success(`${deleted} ${deleted === 1 ? 'quote' : 'quotes'} deleted`)
    if (failed.length) toast.error(`${failed.length} could not be deleted: ${failureMessage}`)
    await queryClient.invalidateQueries({ queryKey: ['admin'] })
    setDeleting(false)
  }

  return (
    <>
      <PageHeader
        title="Quotes"
        actions={
          <Button onClick={() => setImporting(true)}>
            <PlusIcon /> Add to collection
          </Button>
        }
      />
      <Card className="py-4">
        <CardContent className="px-4">
          <fieldset disabled={deleting} className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-6">
            <Input
              className="lg:col-span-2"
              placeholder="Search text…"
              aria-label="Search quotes"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <Input
              placeholder="Author (exact)"
              aria-label="Author"
              value={author}
              onChange={(e) => setAuthor(e.target.value)}
            />
            <NativeSelect
              aria-label="Collection"
              value={search.collection_id ?? ''}
              onChange={(e) => setSearch({ collection_id: e.target.value || undefined })}
            >
              <option value="">All collections</option>
              {collections.data?.collections.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </NativeSelect>
            <NativeSelect
              aria-label="Status"
              value={search.status ?? 'active'}
              onChange={(e) =>
                setSearch({
                  status:
                    e.target.value === 'active'
                      ? undefined
                      : (e.target.value as QuotesSearch['status']),
                })
              }
            >
              <option value="active">Active</option>
              <option value="deleted">Deleted</option>
              <option value="all">All</option>
            </NativeSelect>
            <div className="flex gap-2">
              <Input
                type="date"
                aria-label="From"
                value={search.from ?? ''}
                onChange={(e) => setSearch({ from: e.target.value || undefined })}
              />
              <Input
                type="date"
                aria-label="To"
                value={search.to ?? ''}
                onChange={(e) => setSearch({ to: e.target.value || undefined })}
              />
            </div>
          </fieldset>
          {selected.length > 0 && (
            <div className="mb-4 flex items-center gap-3" aria-live="polite">
              <span className="text-sm">{selected.length} selected on this page</span>
              <Button
                variant="destructive"
                disabled={deleting}
                onClick={() => setConfirmDelete(true)}
              >
                <TrashIcon /> {deleting ? 'Deleting…' : 'Delete selected'}
              </Button>
              <Button variant="outline" disabled={deleting} onClick={() => select([])}>
                Clear selection
              </Button>
            </div>
          )}
          {quotes.isPending ? (
            <Skeleton className="h-40" />
          ) : quotes.data?.quotes.length === 0 ? (
            <EmptyState>No quotes match.</EmptyState>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <Checkbox
                      aria-label="Select all active quotes on this page"
                      disabled={deleting || selectable.length === 0}
                      checked={
                        selected.length > 0 && selected.length === selectable.length
                          ? true
                          : selected.length > 0
                            ? 'indeterminate'
                            : false
                      }
                      onCheckedChange={(checked) => select(checked === true ? selectable : [])}
                    />
                  </TableHead>
                  <TableHead>Quote</TableHead>
                  <TableHead>Author</TableHead>
                  <TableHead>Collection</TableHead>
                  <TableHead>Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {quotes.data?.quotes.map((quote) => (
                  <TableRow
                    key={quote.id}
                    data-state={selected.includes(quote.id) ? 'selected' : undefined}
                  >
                    <TableCell>
                      <Checkbox
                        aria-label={`Select quote: ${quote.quote}`}
                        disabled={deleting || quotes.isPlaceholderData || !!quote.deleted_at}
                        checked={selected.includes(quote.id)}
                        onCheckedChange={(checked) =>
                          select(
                            checked === true
                              ? [...selected, quote.id]
                              : selected.filter((id) => id !== quote.id),
                          )
                        }
                      />
                    </TableCell>
                    <TableCell className="max-w-md">
                      <Link
                        to="/quotes/$id"
                        params={{ id: quote.id }}
                        className="line-clamp-2 hover:underline"
                      >
                        {quote.quote}
                      </Link>
                      {quote.deleted_at && <Badge variant="destructive">deleted</Badge>}
                    </TableCell>
                    <TableCell>{quote.author}</TableCell>
                    <TableCell>{quote.collection.name}</TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {quote.date}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {quotes.data && (
            <Pagination
              page={quotes.data.page}
              pageSize={pageSize}
              disabled={deleting}
              onPageSize={(size) => setSearch({ page_size: size === 25 ? undefined : size })}
              total={quotes.data.total}
              onPage={(page) =>
                !deleting &&
                navigate({ search: (prev) => ({ ...prev, page: page > 1 ? page : undefined }) })
              }
            />
          )}
        </CardContent>
      </Card>
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Delete ${selected.length} selected ${selected.length === 1 ? 'quote' : 'quotes'}?`}
        description="These quotes will be hidden from their collections. You can restore them from the Deleted view."
        confirmLabel="Delete quotes"
        destructive
        onConfirm={() => void deleteSelected()}
      />
      <ImportQuoteDialog
        open={importing}
        onClose={() => setImporting(false)}
        defaultCollectionId={search.collection_id}
      />
    </>
  )
}

function ImportQuoteDialog({
  open,
  onClose,
  defaultCollectionId,
}: {
  open: boolean
  onClose: () => void
  defaultCollectionId: string | undefined
}) {
  const collections = useQuery(allCollectionsQuery)
  const queryClient = useQueryClient()
  const form = useForm<AdminQuoteCreateBody>({
    resolver: typeboxResolver(AdminQuoteCreateBody),
    values: { collection_id: defaultCollectionId ?? '', quote: '', author: '', date: '' },
  })
  const { errors, isSubmitting } = form.formState

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await api.admin.quotes.create(values)
      toast.success('Quote added')
      await queryClient.invalidateQueries({ queryKey: ['admin'] })
      form.reset()
      onClose()
    } catch (err) {
      toast.error(errorMessage(err))
    }
  })

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a quote to a collection</DialogTitle>
          <DialogDescription>
            The quote will be visible to members of the chosen collection.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="grid gap-4" noValidate>
          <Field
            id="collection_id"
            label="Collection"
            error={errors.collection_id ? 'Pick a collection' : undefined}
          >
            <NativeSelect id="collection_id" {...form.register('collection_id')}>
              <option value="">Choose…</option>
              {collections.data?.collections.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field id="quote" label="Quote" error={errors.quote?.message}>
            <Textarea id="quote" {...form.register('quote')} />
          </Field>
          <Field id="author" label="Author" error={errors.author?.message}>
            <Input id="author" {...form.register('author')} />
          </Field>
          <Field id="date" label="Date" hint="Leave empty for today." error={errors.date?.message}>
            <Input id="date" type="date" {...form.register('date')} />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              Add quote
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
