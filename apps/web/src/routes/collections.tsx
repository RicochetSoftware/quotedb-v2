import type { CollectionMemberBody, CollectionTokenCreateBody, TokenCreated } from '@quotedb/shared'
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Checkbox,
  ConfirmDialog,
  Field,
  Input,
  Label,
  NativeSelect,
  toast,
} from '@quotedb/ui'
import { skipToken, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { api, errorMessage } from '../api'
import { useCollection } from '../components/collections'
import { CreatedTokenDialog } from './settings-tokens'

export function CollectionsPage() {
  const { collection, select } = useCollection()
  const cache = useQueryClient()
  const [name, setName] = useState('')
  const [rename, setRename] = useState(collection?.name ?? '')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<CollectionMemberBody['role']>('member')
  const [tokenName, setTokenName] = useState('Discord bot')
  const [write, setWrite] = useState(true)
  const [createdToken, setCreatedToken] = useState<TokenCreated | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmation, setConfirmation] = useState<{
    title: string
    description: string
    run: () => Promise<unknown>
  } | null>(null)
  const manage = collection?.role === 'owner' || collection?.role === 'admin'
  const members = useQuery({
    queryKey: ['collection-members', collection?.id],
    queryFn: collection ? () => api.collections.members(collection.id) : skipToken,
    enabled: !!collection && manage,
  })
  const tokens = useQuery({
    queryKey: ['collection-tokens', collection?.id],
    queryFn: collection ? () => api.collections.tokens(collection.id) : skipToken,
    enabled: !!collection && manage && collection.kind === 'shared',
  })
  async function run(action: () => Promise<unknown>) {
    setBusy(true)
    try {
      await action()
      await cache.invalidateQueries({ queryKey: ['collections'] })
      await cache.invalidateQueries({ queryKey: ['collection-members'] })
      await cache.invalidateQueries({ queryKey: ['collection-tokens'] })
      toast.success('Saved')
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="space-y-6">
      <h1 className="text-2xl font-semibold">Collections</h1>
      <Card>
        <CardHeader>
          <CardTitle>Create a shared collection</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(e) => {
              e.preventDefault()
              void run(async () => {
                const c = await api.collections.create({ name: name.trim() })
                await cache.invalidateQueries({ queryKey: ['collections'] })
                select(c.id)
                setName('')
              })
            }}
          >
            <Field id="collection-name" label="Collection name">
              <Input
                id="collection-name"
                required
                maxLength={100}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Server quotes"
              />
            </Field>
            <Button disabled={busy || !name.trim()}>Create collection</Button>
          </form>
        </CardContent>
      </Card>
      {collection && (
        <Card>
          <CardHeader>
            <CardTitle>{collection.name}</CardTitle>
            <p className="text-sm text-muted-foreground">
              {collection.kind} collection · Your role: {collection.role}
            </p>
          </CardHeader>
          <CardContent className="space-y-5">
            {manage && (
              <form
                className="flex items-end gap-3"
                onSubmit={(e) => {
                  e.preventDefault()
                  void run(() => api.collections.update(collection.id, { name: rename.trim() }))
                }}
              >
                <Field id="rename-collection" label="Name">
                  <Input
                    id="rename-collection"
                    value={rename}
                    required
                    maxLength={100}
                    onChange={(e) => setRename(e.target.value)}
                  />
                </Field>
                <Button disabled={busy || !rename.trim()}>Rename</Button>
              </form>
            )}
            {collection.kind === 'personal' && collection.role === 'owner' && (
              <div className="space-y-3">
                <p>
                  Make this collection shared to use it with a Discord server or invite other
                  QuoteDB accounts. Its quotes and existing tokens stay here. You will receive a
                  new, empty personal collection.
                </p>
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    setConfirmation({
                      title: 'Convert to a shared collection?',
                      description:
                        'All existing quotes stay in this collection. It can then have members and collection-owned bot tokens.',
                      run: () => api.collections.update(collection.id, { kind: 'shared' }),
                    })
                  }
                >
                  Convert to shared
                </Button>
              </div>
            )}
            {manage && collection.kind === 'shared' && (
              <div className="space-y-4">
                <h2 className="font-semibold">Members</h2>
                <p className="text-sm text-muted-foreground">
                  Viewers read quotes. Members can also create, edit, and delete quotes.
                  Administrators manage members and integration tokens. Only the owner can grant
                  administrator access or transfer ownership.
                </p>
                {members.isError && <p role="alert">{errorMessage(members.error)}</p>}
                <ul className="divide-y">
                  {members.data?.members.map((m) => (
                    <li key={m.user_id} className="flex flex-wrap items-center gap-3 py-3">
                      <span className="flex-1">
                        {m.name} · {m.email} · {m.role}
                      </span>
                      {m.role !== 'owner' &&
                        (collection.role === 'owner' || m.role !== 'admin') && (
                          <Button
                            variant="outline"
                            disabled={busy}
                            onClick={() =>
                              setConfirmation({
                                title: `Remove ${m.name}?`,
                                description:
                                  'This removes their website access to this collection. Collection-owned integration tokens remain active until revoked.',
                                run: () => api.collections.removeMember(collection.id, m.user_id),
                              })
                            }
                          >
                            Remove
                          </Button>
                        )}
                      {collection.role === 'owner' && m.role !== 'owner' && (
                        <Button
                          variant="outline"
                          disabled={busy}
                          onClick={() =>
                            setConfirmation({
                              title: `Transfer ownership to ${m.name}?`,
                              description:
                                'They will become the owner and you will become an administrator.',
                              run: () => api.collections.transfer(collection.id, m.user_id),
                            })
                          }
                        >
                          Make owner
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
                <form
                  className="flex flex-wrap items-end gap-3"
                  onSubmit={(e) => {
                    e.preventDefault()
                    void run(async () => {
                      await api.collections.setMember(collection.id, { email, role })
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
                      onChange={(e) => setEmail(e.target.value)}
                    />
                  </Field>
                  <Field id="member-role" label="Role">
                    <NativeSelect
                      id="member-role"
                      value={role}
                      onChange={(e) => setRole(e.target.value as CollectionMemberBody['role'])}
                    >
                      <option value="viewer">Viewer</option>
                      <option value="member">Member</option>
                      {collection.role === 'owner' && <option value="admin">Administrator</option>}
                    </NativeSelect>
                  </Field>
                  <Button disabled={busy}>Add or update member</Button>
                </form>
                <h2 className="pt-4 font-semibold">Integration tokens</h2>
                <p className="text-sm text-muted-foreground">
                  These tokens belong to the collection and keep working if the issuer leaves. Use
                  one with /quote setup in Discord. Revoke unused tokens here.
                </p>
                {tokens.isError && <p role="alert">{errorMessage(tokens.error)}</p>}
                <ul>
                  {tokens.data?.tokens.map((token) => (
                    <li key={token.id} className="flex flex-wrap items-center gap-3 py-2">
                      <span className="flex-1">
                        {token.name} · {token.scopes.join(', ')}
                      </span>
                      <Button
                        variant="outline"
                        disabled={busy}
                        onClick={() =>
                          setConfirmation({
                            title: `Revoke ${token.name}?`,
                            description:
                              'Any bot or script using this key will lose access immediately.',
                            run: () => api.collections.revokeToken(collection.id, token.id),
                          })
                        }
                      >
                        Revoke
                      </Button>
                    </li>
                  ))}
                </ul>
                <form
                  className="flex flex-wrap items-end gap-3"
                  onSubmit={(e) => {
                    e.preventDefault()
                    void run(async () => {
                      const scopes: CollectionTokenCreateBody['scopes'] = write
                        ? ['quotes:read', 'quotes:write']
                        : ['quotes:read']
                      const token = await api.collections.createToken(collection.id, {
                        name: tokenName.trim(),
                        scopes,
                      })
                      setCreatedToken(token)
                    })
                  }}
                >
                  <Field id="integration-name" label="Token name">
                    <Input
                      id="integration-name"
                      required
                      maxLength={100}
                      value={tokenName}
                      onChange={(e) => setTokenName(e.target.value)}
                    />
                  </Field>
                  <Label className="flex items-center gap-2 pb-2">
                    <Checkbox checked={write} onCheckedChange={(v) => setWrite(v === true)} />
                    Allow quote changes
                  </Label>
                  <Button disabled={busy || !tokenName.trim()}>Create integration token</Button>
                </form>
              </div>
            )}
          </CardContent>
        </Card>
      )}
      <CreatedTokenDialog token={createdToken} onClose={() => setCreatedToken(null)} />
      <ConfirmDialog
        open={!!confirmation}
        onOpenChange={(open) => !open && setConfirmation(null)}
        title={confirmation?.title ?? ''}
        description={confirmation?.description ?? ''}
        confirmLabel="Confirm"
        onConfirm={() => {
          const action = confirmation?.run
          setConfirmation(null)
          if (action) void run(action)
        }}
      />
    </section>
  )
}
