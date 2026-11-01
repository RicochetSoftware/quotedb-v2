import { ForgotPasswordBody } from '@quotedb/shared'
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
  typeboxResolver,
} from '@quotedb/ui'
import { Link } from '@tanstack/react-router'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { api, errorMessage } from '../api'

export function ForgotPasswordPage() {
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const form = useForm<ForgotPasswordBody>({
    resolver: typeboxResolver(ForgotPasswordBody),
    defaultValues: { email: '' },
  })

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null)
    try {
      await api.auth.forgotPassword(values)
      setSent(true)
    } catch (err) {
      setError(errorMessage(err))
    }
  })

  return (
    <Card className="mx-auto mt-8 max-w-sm">
      <CardHeader>
        <CardTitle className="text-xl">Reset your password</CardTitle>
        <CardDescription>We'll email you a link to choose a new password.</CardDescription>
      </CardHeader>
      <CardContent>
        {sent ? (
          <div className="grid gap-4">
            <Alert>
              If an account exists for that email, a reset link is on its way. It expires in an
              hour.
            </Alert>
            <Button variant="outline" asChild>
              <Link to="/login">Back to log in</Link>
            </Button>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="grid gap-4" noValidate>
            {error && <Alert variant="destructive">{error}</Alert>}
            <Field id="email" label="Email" error={form.formState.errors.email?.message}>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                autoFocus
                {...form.register('email')}
              />
            </Field>
            <Button type="submit" disabled={form.formState.isSubmitting}>
              Send reset link
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  )
}
