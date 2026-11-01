import { type AdminUser, AdminUserUpdateBody, ROLES } from '@quotedb/shared'
import {
  Alert,
  Badge,
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
  toast,
  typeboxResolver,
} from '@quotedb/ui'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from '@tanstack/react-router'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { api, errorMessage, meQuery } from '../api'
import { PageHeader } from '../components/layout'

export function UserDetailPage() {
  const { id } = useParams({ from: '/authed/users/$id' })
  const user = useQuery({ queryKey: ['admin', 'user', id], queryFn: () => api.admin.users.get(id) })
  const quotes = useQuery({
    queryKey: ['admin', 'user', id, 'quotes'],
    queryFn: () => api.admin.users.quotes(id),
  })

  if (user.isPending) return <Skeleton className="h-64" />
  if (user.isError) return <EmptyState>{errorMessage(user.error)}</EmptyState>
  const u = user.data

  return (
    <>
      <PageHeader title={u.name} />
      <div className="grid gap-6 lg:grid-cols-2">
        <EditUserCard user={u} />
        <AccountActionsCard user={u} />
      </div>
      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Quotes ({quotes.data?.quotes.length ?? '…'})</CardTitle>
        </CardHeader>
        <CardContent>
          {quotes.data?.quotes.length === 0 ? (
            <EmptyState>No quotes.</EmptyState>
          ) : (
            <ul className="divide-y">
              {quotes.data?.quotes.map((q) => (
                <li key={q.id} className="py-2">
                  <Link to="/quotes/$id" params={{ id: q.id }} className="hover:underline">
                    “{q.quote}”
                  </Link>{' '}
                  <span className="text-sm text-muted-foreground">
                    — {q.author}, {q.date}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </>
  )
}

function EditUserCard({ user }: { user: AdminUser }) {
  const { data: me } = useQuery(meQuery)
  const queryClient = useQueryClient()
  const form = useForm<AdminUserUpdateBody>({
    resolver: typeboxResolver(AdminUserUpdateBody),
    values: { name: user.name, email: user.email, role: user.role },
  })
  const { errors, isSubmitting } = form.formState

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await api.admin.users.update(user.id, values)
      toast.success('Saved')
      await queryClient.invalidateQueries({ queryKey: ['admin'] })
    } catch (err) {
      toast.error(errorMessage(err))
    }
  })

  const isSelf = me?.id === user.id
  return (
    <Card>
      <CardHeader>
        <CardTitle>Details</CardTitle>
        <CardDescription>
          Created {formatDate(user.created_at)}
          {user.external_id !== null && ` · v1 id ${user.external_id}`}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="grid gap-4" noValidate>
          <Field id="name" label="Name" error={errors.name?.message}>
            <Input id="name" {...form.register('name')} />
          </Field>
          <Field id="email" label="Email" error={errors.email?.message}>
            <Input id="email" type="email" {...form.register('email')} />
          </Field>
          <Field
            id="role"
            label="Role"
            hint={isSelf ? "You can't change your own role." : undefined}
          >
            <NativeSelect id="role" disabled={isSelf} {...form.register('role')}>
              {ROLES.filter(
                (r) =>
                  r !== 'SUPER_ADMIN' || me?.role === 'SUPER_ADMIN' || user.role === 'SUPER_ADMIN',
              ).map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Button
            type="submit"
            className="w-fit"
            disabled={isSubmitting || !form.formState.isDirty}
          >
            Save changes
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}

function AccountActionsCard({ user }: { user: AdminUser }) {
  const { data: me } = useQuery(meQuery)
  const queryClient = useQueryClient()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['admin'] })

  const reset = useMutation({
    mutationFn: () => api.admin.users.sendPasswordReset(user.id),
    onSuccess: () =>
      toast.success(`${user.password_set ? 'Reset' : 'Invite'} email sent to ${user.email}`),
    onError: (err) => toast.error(errorMessage(err)),
  })
  const remove = useMutation({
    mutationFn: () => api.admin.users.remove(user.id),
    onSuccess: () => {
      toast.success('User deleted')
      return invalidate()
    },
    onError: (err) => toast.error(errorMessage(err)),
  })
  const restore = useMutation({
    mutationFn: () => api.admin.users.restore(user.id),
    onSuccess: () => {
      toast.success('User restored')
      return invalidate()
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle>Account</CardTitle>
        <CardDescription className="flex flex-wrap gap-1">
          <Badge variant="secondary">{user.role}</Badge>
          {user.deleted_at && (
            <Badge variant="destructive">deleted {formatDate(user.deleted_at)}</Badge>
          )}
          {!user.password_set && <Badge variant="outline">invite pending</Badge>}
          {user.legacy_password && <Badge variant="outline">legacy bcrypt password</Badge>}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {user.deleted_at ? (
          <>
            <Alert>
              Deleted users can't sign in and their tokens stop working. Their quotes are kept.
            </Alert>
            <Button className="w-fit" onClick={() => restore.mutate()} disabled={restore.isPending}>
              Restore user
            </Button>
          </>
        ) : (
          <>
            <div className="grid gap-2">
              <Button
                variant="outline"
                className="w-fit"
                onClick={() => reset.mutate()}
                disabled={reset.isPending}
              >
                {user.password_set ? 'Send password reset email' : 'Resend invite'}
              </Button>
              <p className="text-sm text-muted-foreground">The link is emailed to {user.email}.</p>
            </div>
            <Button
              variant="destructive"
              className="w-fit"
              disabled={me?.id === user.id}
              onClick={() => setConfirmDelete(true)}
            >
              Delete user
            </Button>
          </>
        )}
      </CardContent>
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Delete ${user.name}?`}
        description="They're signed out everywhere and can't sign in. You can restore them later."
        confirmLabel="Delete"
        destructive
        onConfirm={() => remove.mutate()}
      />
    </Card>
  )
}
