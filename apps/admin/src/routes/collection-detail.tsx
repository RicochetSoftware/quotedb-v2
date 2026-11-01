import type { CollectionMemberBody, CollectionSummary } from '@quotedb/shared'
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  ConfirmDialog,
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
  toast,
} from '@quotedb/ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from '@tanstack/react-router'
import { useState } from 'react'
import { api, errorMessage } from '../api'
import { PageHeader } from '../components/layout'

type MemberRole = CollectionMemberBody['role']
export function CollectionDetailPage() {
  const { id } = useParams({ from: '/authed/collections/$id' })
  const collection = useQuery({
    queryKey: ['admin', 'collection', id],
    queryFn: () => api.admin.collection.get(id),
  })
  if (collection.isPending) return <Skeleton className="h-64" />
  if (collection.isError) return <EmptyState>{errorMessage(collection.error)}</EmptyState>
  return <CollectionEditor key={id} collection={collection.data} />
}

function CollectionEditor({ collection }: { collection: CollectionSummary }) {
  const { id } = collection
  const cache = useQueryClient()
  const [name, setName] = useState(collection.name)
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<MemberRole>('member')
  const [busy, setBusy] = useState(false)
  const [confirmation, setConfirmation] = useState<{
    title: string
    description: string
    action: () => Promise<unknown>
  } | null>(null)
  const members = useQuery({
    queryKey: ['admin', 'collection', id, 'members'],
    queryFn: () => api.admin.collection.members(id),
  })
  async function run(action: () => Promise<unknown>) {
    setBusy(true)
    try {
      await action()
      await cache.invalidateQueries({ queryKey: ['admin'] })
      toast.success('Saved')
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <PageHeader
        title={collection.name}
        actions={
          <Button variant="outline" asChild>
            <Link to="/quotes" search={{ collection_id: id }}>
              View quotes
            </Link>
          </Button>
        }
      />
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Collection details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Badge variant="outline">{collection.kind === 'shared' ? 'Shared' : 'Personal'}</Badge>
            <form
              className="flex flex-wrap items-end gap-3"
              onSubmit={(event) => {
                event.preventDefault()
                void run(() => api.admin.collection.update(id, { name: name.trim() }))
              }}
            >
              <Field id="collection-name" label="Name">
                <Input
                  id="collection-name"
                  value={name}
                  required
                  maxLength={100}
                  onChange={(event) => setName(event.target.value)}
                />
              </Field>
              <Button disabled={busy || !name.trim()}>Save name</Button>
            </form>
            {collection.kind === 'personal' && (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Convert to shared before adding members or changing ownership. Quotes and tokens
                  stay in this collection; its current owner receives a new empty personal
                  collection.
                </p>
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    setConfirmation({
                      title: 'Convert to a shared collection?',
                      description:
                        'Existing quotes and tokens stay here. The current owner receives a new empty personal collection.',
                      action: () => api.admin.collection.update(id, { kind: 'shared' }),
                    })
                  }
                >
                  Convert to shared
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Members</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Viewers can read quotes. Members can also create, edit, and delete quotes.
              Administrators manage members and integration tokens. The owner can transfer
              ownership.
            </p>
            {members.isPending ? (
              <Skeleton className="h-32" />
            ) : members.isError ? (
              <EmptyState>{errorMessage(members.error)}</EmptyState>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>User</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {members.data.members.map((member) => (
                    <TableRow key={member.user_id}>
                      <TableCell>
                        <Link
                          to="/users/$id"
                          params={{ id: member.user_id }}
                          className="font-medium hover:underline"
                        >
                          {member.name}
                        </Link>
                        <div className="text-sm text-muted-foreground">{member.email}</div>
                      </TableCell>
                      <TableCell>
                        {member.role === 'owner' ? (
                          <Badge>Owner</Badge>
                        ) : (
                          <NativeSelect
                            aria-label={`Role for ${member.email}`}
                            value={member.role}
                            disabled={busy}
                            onChange={(event) =>
                              void run(() =>
                                api.admin.collection.setMember(id, {
                                  email: member.email,
                                  role: event.target.value as MemberRole,
                                }),
                              )
                            }
                          >
                            <option value="viewer">Viewer</option>
                            <option value="member">Member</option>
                            <option value="admin">Administrator</option>
                          </NativeSelect>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {collection.kind === 'shared' && member.role !== 'owner' && (
                          <div className="flex justify-end gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={busy}
                              onClick={() =>
                                setConfirmation({
                                  title: `Make ${member.name} the owner?`,
                                  description:
                                    'The existing owner becomes an administrator. Quotes and integration tokens remain in this collection.',
                                  action: () => api.admin.collection.transfer(id, member.user_id),
                                })
                              }
                            >
                              Make owner
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={busy}
                              onClick={() =>
                                setConfirmation({
                                  title: `Remove ${member.name}?`,
                                  description:
                                    'They will lose access to this collection. Collection integration tokens remain active.',
                                  action: () =>
                                    api.admin.collection.removeMember(id, member.user_id),
                                })
                              }
                            >
                              Remove
                            </Button>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
            {collection.kind === 'shared' && (
              <form
                className="flex flex-wrap items-end gap-3"
                onSubmit={(event) => {
                  event.preventDefault()
                  void run(async () => {
                    await api.admin.collection.setMember(id, { email: email.trim(), role })
                    setEmail('')
                  })
                }}
              >
                <Field id="member-email" label="Existing account email">
                  <Input
                    id="member-email"
                    type="email"
                    required
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                  />
                </Field>
                <Field id="member-role" label="Role">
                  <NativeSelect
                    id="member-role"
                    value={role}
                    onChange={(event) => setRole(event.target.value as MemberRole)}
                  >
                    <option value="viewer">Viewer</option>
                    <option value="member">Member</option>
                    <option value="admin">Administrator</option>
                  </NativeSelect>
                </Field>
                <Button disabled={busy || !email.trim()}>Add or update member</Button>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
      <ConfirmDialog
        open={!!confirmation}
        onOpenChange={(open) => !open && setConfirmation(null)}
        title={confirmation?.title ?? ''}
        description={confirmation?.description ?? ''}
        confirmLabel="Confirm"
        onConfirm={() => {
          const action = confirmation?.action
          setConfirmation(null)
          if (action) void run(action)
        }}
      />
    </>
  )
}
