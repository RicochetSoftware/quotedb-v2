import { NewPassword } from '@quotedb/shared'
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Checkbox,
  Field,
  Input,
  Label,
  relativeTime,
  toast,
  typeboxResolver,
} from '@quotedb/ui'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Controller, useForm } from 'react-hook-form'
import Type from 'typebox'
import { api, errorMessage, meQuery, sessionsQuery } from '../api'

const PasswordForm = Type.Object({
  current_password: Type.String({ minLength: 1 }),
  new_password: NewPassword,
  confirm: Type.String({ minLength: 1 }),
  revoke_other_sessions: Type.Boolean(),
})
type PasswordForm = Type.Static<typeof PasswordForm>

export function AccountPage() {
  const { data: me } = useQuery(meQuery)
  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
          <CardDescription>Ask an admin to change your name or email.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-1 text-sm">
          <div className="font-medium">{me?.name}</div>
          <div className="text-muted-foreground">{me?.email}</div>
          {me && me.role !== 'USER' && <Badge variant="secondary">{me.role}</Badge>}
        </CardContent>
      </Card>
      <ChangePasswordCard />
      <SessionsCard />
    </div>
  )
}

function ChangePasswordCard() {
  const queryClient = useQueryClient()
  const form = useForm<PasswordForm>({
    resolver: typeboxResolver(PasswordForm),
    defaultValues: {
      current_password: '',
      new_password: '',
      confirm: '',
      revoke_other_sessions: true,
    },
  })
  const { errors, isSubmitting } = form.formState

  const onSubmit = form.handleSubmit(async ({ confirm, ...body }) => {
    if (body.new_password !== confirm) {
      form.setError('confirm', { message: "Passwords don't match" })
      return
    }
    try {
      await api.auth.changePassword(body)
      toast.success('Password changed')
      form.reset()
      await queryClient.invalidateQueries({ queryKey: sessionsQuery.queryKey })
    } catch (err) {
      toast.error(errorMessage(err))
    }
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle>Change password</CardTitle>
        <CardDescription>
          At least 12 characters. Passwords found in known data breaches are refused.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="grid max-w-sm gap-4" noValidate>
          <Field
            id="current_password"
            label="Current password"
            error={errors.current_password?.message}
          >
            <Input
              id="current_password"
              type="password"
              autoComplete="current-password"
              {...form.register('current_password')}
            />
          </Field>
          <Field id="new_password" label="New password" error={errors.new_password?.message}>
            <Input
              id="new_password"
              type="password"
              autoComplete="new-password"
              {...form.register('new_password')}
            />
          </Field>
          <Field id="confirm" label="Confirm new password" error={errors.confirm?.message}>
            <Input
              id="confirm"
              type="password"
              autoComplete="new-password"
              {...form.register('confirm')}
            />
          </Field>
          <div className="flex items-center gap-2">
            <Controller
              control={form.control}
              name="revoke_other_sessions"
              render={({ field }) => (
                <Checkbox
                  id="revoke"
                  checked={field.value}
                  onCheckedChange={(v) => field.onChange(v === true)}
                />
              )}
            />
            <Label htmlFor="revoke" className="font-normal">
              Sign out my other sessions
            </Label>
          </div>
          <Button type="submit" className="w-fit" disabled={isSubmitting}>
            Change password
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}

function SessionsCard() {
  const queryClient = useQueryClient()
  const sessions = useQuery(sessionsQuery)
  const others = sessions.data?.sessions.filter((s) => !s.current) ?? []
  const logoutOthers = useMutation({
    mutationFn: () => api.auth.logoutOthers(),
    onSuccess: () => {
      toast.success('Signed out of other sessions')
      return queryClient.invalidateQueries({ queryKey: sessionsQuery.queryKey })
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sessions</CardTitle>
        <CardDescription>Browsers where you're signed in.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <ul className="divide-y rounded-md border text-sm">
          {sessions.data?.sessions.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
              <span className="max-w-full truncate">{s.user_agent ?? 'Unknown device'}</span>
              {s.current && <Badge variant="secondary">This browser</Badge>}
              <span className="ml-auto text-muted-foreground">
                {s.ip} · active {relativeTime(s.last_seen_at ?? s.created_at)}
              </span>
            </li>
          ))}
        </ul>
        <Button
          variant="outline"
          className="w-fit"
          disabled={others.length === 0 || logoutOthers.isPending}
          onClick={() => logoutOthers.mutate()}
        >
          Sign out other sessions
        </Button>
      </CardContent>
    </Card>
  )
}
