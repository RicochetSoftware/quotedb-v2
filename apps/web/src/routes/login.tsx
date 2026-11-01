import { LoginBody } from '@quotedb/shared'
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
import { useQueryClient } from '@tanstack/react-query'
import { Link, useRouter, useSearch } from '@tanstack/react-router'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { api, errorMessage, meQuery } from '../api'

export function LoginPage() {
  const search = useSearch({ from: '/login' })
  const router = useRouter()
  const queryClient = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const form = useForm<LoginBody>({
    resolver: typeboxResolver(LoginBody),
    defaultValues: { email: '', password: '' },
  })
  const { errors, isSubmitting } = form.formState

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null)
    try {
      const me = await api.auth.login(values)
      queryClient.setQueryData(meQuery.queryKey, me)
      router.history.push(search.redirect ?? '/quotes')
    } catch (err) {
      setError(errorMessage(err))
    }
  })

  return (
    <Card className="mx-auto mt-8 max-w-sm">
      <CardHeader>
        <CardTitle className="text-xl">Log in</CardTitle>
        <CardDescription>Log in to view quotes.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="grid gap-4" noValidate>
          {error && <Alert variant="destructive">{error}</Alert>}
          <Field id="email" label="Email" error={errors.email?.message}>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              autoFocus
              aria-invalid={!!errors.email}
              {...form.register('email')}
            />
          </Field>
          <Field id="password" label="Password" error={errors.password?.message}>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              aria-invalid={!!errors.password}
              {...form.register('password')}
            />
          </Field>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Logging in…' : 'Log in'}
          </Button>
          <Link
            to="/forgot-password"
            className="text-center text-sm text-muted-foreground underline-offset-4 hover:underline"
          >
            Forgot your password?
          </Link>
        </form>
      </CardContent>
    </Card>
  )
}
