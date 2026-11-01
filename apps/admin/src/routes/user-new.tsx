import { AdminUserCreateBody, ROLES } from '@quotedb/shared'
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Field,
  Input,
  NativeSelect,
  toast,
  typeboxResolver,
} from '@quotedb/ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useForm } from 'react-hook-form'
import { api, errorMessage, meQuery } from '../api'
import { PageHeader } from '../components/layout'

export function UserNewPage() {
  const { data: me } = useQuery(meQuery)
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const form = useForm<AdminUserCreateBody>({
    resolver: typeboxResolver(AdminUserCreateBody),
    defaultValues: { email: '', name: '', role: 'USER', password: '' },
  })
  const { errors, isSubmitting } = form.formState

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const user = await api.admin.users.create(values)
      toast.success(values.password ? 'User created' : `Invite sent to ${user.email}`)
      await queryClient.invalidateQueries({ queryKey: ['admin'] })
      await navigate({ to: '/users/$id', params: { id: user.id } })
    } catch (err) {
      toast.error(errorMessage(err))
    }
  })

  return (
    <>
      <PageHeader title="New user" />
      <Card className="max-w-lg">
        <CardHeader>
          <CardTitle>Account details</CardTitle>
          <CardDescription>
            Leave the password empty to email an invite link where the user picks their own (valid 7
            days).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="grid gap-4" noValidate>
            <Field id="name" label="Name" error={errors.name?.message}>
              <Input id="name" autoFocus {...form.register('name')} />
            </Field>
            <Field id="email" label="Email" error={errors.email?.message}>
              <Input id="email" type="email" {...form.register('email')} />
            </Field>
            <Field id="role" label="Role" error={errors.role?.message}>
              <NativeSelect id="role" {...form.register('role')}>
                {ROLES.filter((r) => r !== 'SUPER_ADMIN' || me?.role === 'SUPER_ADMIN').map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field
              id="password"
              label="Initial password (optional)"
              error={errors.password?.message}
            >
              <Input
                id="password"
                type="password"
                autoComplete="new-password"
                {...form.register('password')}
              />
            </Field>
            <Button type="submit" className="w-fit" disabled={isSubmitting}>
              Create user
            </Button>
          </form>
        </CardContent>
      </Card>
    </>
  )
}
