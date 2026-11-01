import { ROLES } from '@quotedb/shared'
import {
  Badge,
  Button,
  Card,
  CardContent,
  EmptyState,
  Input,
  NativeSelect,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@quotedb/ui'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Link, useNavigate, useSearch } from '@tanstack/react-router'
import { PlusIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from '../api'
import { PageHeader, Pagination } from '../components/layout'
import type { UsersSearch } from '../router'

export function UsersPage() {
  const search = useSearch({ from: '/authed/users' })
  const pageSize = search.page_size ?? 25
  const navigate = useNavigate({ from: '/users' })
  const [q, setQ] = useState(search.q ?? '')
  const setSearch = (patch: Partial<UsersSearch>) =>
    navigate({ search: (prev) => ({ ...prev, page: undefined, ...patch }), replace: true })

  // Debounce the free-text search into the URL.
  useEffect(() => {
    const t = setTimeout(() => {
      if ((search.q ?? '') !== q) setSearch({ q: q || undefined })
    }, 250)
    return () => clearTimeout(t)
  })

  const users = useQuery({
    queryKey: ['admin', 'users', search],
    queryFn: () => api.admin.users.list({ ...search, page_size: pageSize }),
    placeholderData: keepPreviousData,
  })

  return (
    <>
      <PageHeader
        title="Users"
        actions={
          <Button asChild>
            <Link to="/users/new">
              <PlusIcon /> New user
            </Link>
          </Button>
        }
      />
      <Card className="py-4">
        <CardContent className="px-4">
          <div className="mb-4 flex flex-col gap-2 sm:flex-row">
            <Input
              placeholder="Search name or email…"
              aria-label="Search users"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <NativeSelect
              aria-label="Role"
              className="sm:w-44"
              value={search.role ?? ''}
              onChange={(e) =>
                setSearch({ role: (e.target.value || undefined) as UsersSearch['role'] })
              }
            >
              <option value="">All roles</option>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </NativeSelect>
            <NativeSelect
              aria-label="Status"
              className="sm:w-36"
              value={search.status ?? 'active'}
              onChange={(e) =>
                setSearch({
                  status:
                    e.target.value === 'active'
                      ? undefined
                      : (e.target.value as UsersSearch['status']),
                })
              }
            >
              <option value="active">Active</option>
              <option value="deleted">Deleted</option>
              <option value="all">All</option>
            </NativeSelect>
          </div>
          {users.isPending ? (
            <Skeleton className="h-40" />
          ) : users.data?.users.length === 0 ? (
            <EmptyState>No users match.</EmptyState>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead className="text-right">Quotes</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.data?.users.map((u) => (
                  <TableRow key={u.id}>
                    <TableCell className="font-medium">
                      <Link to="/users/$id" params={{ id: u.id }} className="hover:underline">
                        {u.name}
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{u.email}</TableCell>
                    <TableCell>
                      <Badge variant={u.role === 'USER' ? 'outline' : 'secondary'}>{u.role}</Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{u.quote_count}</TableCell>
                    <TableCell className="space-x-1">
                      {u.deleted_at && <Badge variant="destructive">deleted</Badge>}
                      {!u.password_set && <Badge variant="outline">invited</Badge>}
                      {u.legacy_password && <Badge variant="outline">legacy password</Badge>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {users.data && (
            <Pagination
              page={users.data.page}
              pageSize={pageSize}
              onPageSize={(size) => setSearch({ page_size: size === 25 ? undefined : size })}
              total={users.data.total}
              onPage={(page) =>
                navigate({ search: (prev) => ({ ...prev, page: page > 1 ? page : undefined }) })
              }
            />
          )}
        </CardContent>
      </Card>
    </>
  )
}
