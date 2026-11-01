import { NewPassword } from '@quotedb/shared'
import {
  Alert,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Field,
  Input,
  toast,
  typeboxResolver,
} from '@quotedb/ui'
import { Link, useNavigate, useSearch } from '@tanstack/react-router'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import Type from 'typebox'
import { api, errorMessage } from '../api'

const ResetForm = Type.Object({ new_password: NewPassword, confirm: Type.String({ minLength: 1 }) })
type ResetForm = Type.Static<typeof ResetForm>

export function ResetPasswordPage() {
  const { token, invite } = useSearch({ from: '/reset-password' })
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)
  const form = useForm<ResetForm>({
    resolver: typeboxResolver(ResetForm),
    defaultValues: { new_password: '', confirm: '' },
  })
  const { errors, isSubmitting } = form.formState

  const onSubmit = form.handleSubmit(async ({ new_password, confirm }) => {
    if (new_password !== confirm) {
      form.setError('confirm', { message: "Passwords don't match" })
      return
    }
    setError(null)
    try {
      await api.auth.resetPassword({ token: token ?? '', new_password })
      toast.success(invite ? 'Password set. Welcome!' : 'Password updated. Please log in again.')
      await navigate({ to: '/login' })
    } catch (err) {
      setError(errorMessage(err))
    }
  })

  if (!token) {
    return (
      <Card className="mx-auto mt-8 max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl">Link incomplete</CardTitle>
          <CardDescription>
            This reset link is missing its token. Request a new one.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline">
            <Link to="/forgot-password">Request a new link</Link>
          </Button>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="mx-auto mt-8 max-w-sm">
      <CardHeader>
        <CardTitle className="text-xl">
          {invite ? 'Choose your password' : 'Set a new password'}
        </CardTitle>
        <CardDescription>
          At least 12 characters. Passwords found in known data breaches are refused.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="grid gap-4" noValidate>
          {error && (
            <Alert variant="destructive">
              {error}{' '}
              <Link to="/forgot-password" className="underline">
                Request a new link
              </Link>
            </Alert>
          )}
          <Field id="new_password" label="New password" error={errors.new_password?.message}>
            <Input
              id="new_password"
              type="password"
              autoComplete="new-password"
              autoFocus
              {...form.register('new_password')}
            />
          </Field>
          <Field id="confirm" label="Confirm password" error={errors.confirm?.message}>
            <Input
              id="confirm"
              type="password"
              autoComplete="new-password"
              {...form.register('confirm')}
            />
          </Field>
          <Button type="submit" disabled={isSubmitting}>
            {invite ? 'Set password' : 'Update password'}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
