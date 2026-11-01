import { AdminQuoteCreateBody } from '@quotedb/shared'
import {
  Badge,
  Button,
  Card,
  CardContent,
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
import { PlusIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { allUsersQuery, api, errorMessage } from '../api'
import { PageHeader, Pagination } from '../components/layout'
import type { QuotesSearch } from '../router'

const PAGE_SIZE = 25

export function QuotesPage() {
  const search = useSearch({ from: '/authed/quotes' })
  const navigate = useNavigate({ from: '/quotes' })
  const users = useQuery(allUsersQuery)
  const [q, setQ] = useState(search.q ?? '')
  const [author, setAuthor] = useState(search.author ?? '')
  const [importing, setImporting] = useState(false)
  const setSearch = (patch: Partial<QuotesSearch>) =>
    navigate({ search: (prev) => ({ ...prev, page: undefined, ...patch }), replace: true })

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
    queryFn: () => api.admin.quotes.list({ ...search, page_size: PAGE_SIZE }),
    placeholderData: keepPreviousData,
  })

  return (
    <>
      <PageHeader
        title="Quotes"
        actions={
          <Button onClick={() => setImporting(true)}>
            <PlusIcon /> Add for user
          </Button>
        }
      />
      <Card className="py-4">
        <CardContent className="px-4">
          <div className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-6">
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
              aria-label="User"
              value={search.user_id ?? ''}
              onChange={(e) => setSearch({ user_id: e.target.value || undefined })}
            >
              <option value="">All users</option>
              {users.data?.users.map((u) => (
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
          </div>
          {quotes.isPending ? (
            <Skeleton className="h-40" />
          ) : quotes.data?.quotes.length === 0 ? (
            <EmptyState>No quotes match.</EmptyState>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Quote</TableHead>
                  <TableHead>Author</TableHead>
                  <TableHead>User</TableHead>
                  <TableHead>Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {quotes.data?.quotes.map((quote) => (
                  <TableRow key={quote.id}>
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
                    <TableCell>
                      <Link
                        to="/users/$id"
                        params={{ id: quote.user.id }}
                        className="text-muted-foreground hover:underline"
                      >
                        {quote.user.name}
                      </Link>
                    </TableCell>
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
              pageSize={PAGE_SIZE}
              total={quotes.data.total}
              onPage={(page) =>
                navigate({ search: (prev) => ({ ...prev, page: page > 1 ? page : undefined }) })
              }
            />
          )}
        </CardContent>
      </Card>
      <ImportQuoteDialog
        open={importing}
        onClose={() => setImporting(false)}
        defaultUserId={search.user_id}
      />
    </>
  )
}

function ImportQuoteDialog({
  open,
  onClose,
  defaultUserId,
}: {
  open: boolean
  onClose: () => void
  defaultUserId: string | undefined
}) {
  const users = useQuery(allUsersQuery)
  const queryClient = useQueryClient()
  const form = useForm<AdminQuoteCreateBody>({
    resolver: typeboxResolver(AdminQuoteCreateBody),
    values: { user_id: defaultUserId ?? '', quote: '', author: '', date: '' },
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
          <DialogTitle>Add a quote for a user</DialogTitle>
          <DialogDescription>
            The quote is owned by the chosen user, as if they had added it.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="grid gap-4" noValidate>
          <Field id="user_id" label="User" error={errors.user_id ? 'Pick a user' : undefined}>
            <NativeSelect id="user_id" {...form.register('user_id')}>
              <option value="">Choose…</option>
              {users.data?.users
                .filter((u) => !u.deleted_at)
                .map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name} ({u.email})
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
