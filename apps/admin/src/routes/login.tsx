import { isAdminRole, LoginBody } from '@quotedb/shared'
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
import { useNavigate, useRouter, useSearch } from '@tanstack/react-router'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { api, errorMessage, meQuery, WEB_URL } from '../api'

export function LoginPage() {
  const search = useSearch({ from: '/login' })
  const router = useRouter()
  const navigate = useNavigate()
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
      if (!isAdminRole(me.role)) await navigate({ to: '/forbidden' })
      else router.history.push(search.redirect ?? '/')
    } catch (err) {
      setError(errorMessage(err))
    }
  })

  return (
    <div className="flex min-h-svh items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl">QuoteDB Admin</CardTitle>
          <CardDescription>Sign in with an admin account.</CardDescription>
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
                {...form.register('email')}
              />
            </Field>
            <Field id="password" label="Password" error={errors.password?.message}>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                {...form.register('password')}
              />
            </Field>
            <Button type="submit" disabled={isSubmitting}>
              Sign in
            </Button>
            <a
              href={`${WEB_URL}/forgot-password`}
              className="text-center text-sm text-muted-foreground hover:underline"
            >
              Forgot your password?
            </a>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
