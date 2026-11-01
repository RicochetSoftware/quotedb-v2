import { AdminQuoteUpdateBody } from '@quotedb/shared'
import {
  Alert,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  ConfirmDialog,
  EmptyState,
  Field,
  formatDate,
  Input,
  NativeSelect,
  Skeleton,
  Textarea,
  toast,
  typeboxResolver,
} from '@quotedb/ui'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useParams } from '@tanstack/react-router'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { allCollectionsQuery, api, errorMessage } from '../api'
import { PageHeader } from '../components/layout'

export function QuoteDetailPage() {
  const { id } = useParams({ from: '/authed/quotes/$id' })
  const queryClient = useQueryClient()
  const collections = useQuery(allCollectionsQuery)
  const quote = useQuery({
    queryKey: ['admin', 'quote', id],
    queryFn: () => api.admin.quotes.get(id),
  })
  const [confirmDelete, setConfirmDelete] = useState(false)
  const form = useForm<AdminQuoteUpdateBody>({
    resolver: typeboxResolver(AdminQuoteUpdateBody),
    values: quote.data && {
      quote: quote.data.quote,
      author: quote.data.author,
      date: quote.data.date,
      collection_id: quote.data.collection.id,
    },
  })
  const { errors, isSubmitting } = form.formState
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['admin'] })

  const remove = useMutation({
    mutationFn: () => api.admin.quotes.remove(id),
    onSuccess: () => {
      toast.success('Quote deleted')
      return invalidate()
    },
    onError: (err) => toast.error(errorMessage(err)),
  })
  const restore = useMutation({
    mutationFn: () => api.admin.quotes.restore(id),
    onSuccess: () => {
      toast.success('Quote restored')
      return invalidate()
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await api.admin.quotes.update(id, values)
      toast.success('Saved')
      await invalidate()
    } catch (err) {
      toast.error(errorMessage(err))
    }
  })

  if (quote.isPending) return <Skeleton className="h-64" />
  if (quote.isError) return <EmptyState>{errorMessage(quote.error)}</EmptyState>
  const q = quote.data

  return (
    <>
      <PageHeader title="Edit quote" />
      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle>{q.collection.name}</CardTitle>
          <CardDescription>
            Added {formatDate(q.created_at)} · updated {formatDate(q.updated_at)}
            {q.external_id !== null && ` · v1 id ${q.external_id}`}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-6">
          {q.deleted_at && (
            <Alert variant="warning" className="flex items-center justify-between gap-4">
              Deleted {formatDate(q.deleted_at)}. It's hidden from its collection.
              <Button size="sm" onClick={() => restore.mutate()} disabled={restore.isPending}>
                Restore
              </Button>
            </Alert>
          )}
          <form onSubmit={onSubmit} className="grid gap-4" noValidate>
            <Field id="quote" label="Quote" error={errors.quote?.message}>
              <Textarea id="quote" rows={4} {...form.register('quote')} />
            </Field>
            <Field id="author" label="Author" error={errors.author?.message}>
              <Input id="author" {...form.register('author')} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="date" label="Date" error={errors.date?.message}>
                <Input id="date" type="date" {...form.register('date')} />
              </Field>
              <Field id="collection_id" label="Collection">
                <NativeSelect id="collection_id" {...form.register('collection_id')}>
                  {collections.data?.collections.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            </div>
            <div className="flex gap-2">
              <Button type="submit" disabled={isSubmitting || !form.formState.isDirty}>
                Save changes
              </Button>
              {!q.deleted_at && (
                <Button type="button" variant="destructive" onClick={() => setConfirmDelete(true)}>
                  Delete
                </Button>
              )}
            </div>
          </form>
        </CardContent>
      </Card>
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete this quote?"
        description="It's soft-deleted: hidden from its collection, restorable here."
        confirmLabel="Delete"
        destructive
        onConfirm={() => remove.mutate()}
      />
    </>
  )
}
