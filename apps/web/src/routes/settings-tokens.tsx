import {
  type ApiToken,
  DEFAULT_TOKEN_SCOPES,
  SCOPE_DESCRIPTIONS,
  SCOPES,
  type Scope,
  type TokenCreated,
} from '@quotedb/shared'
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Checkbox,
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Field,
  Input,
  Label,
  NativeSelect,
  relativeTime,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  toast,
} from '@quotedb/ui'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CopyIcon, PlusIcon } from 'lucide-react'
import { useState } from 'react'
import { api, errorMessage, tokensQuery } from '../api'

const EXPIRY_OPTIONS = [
  { value: '90', label: '90 days' },
  { value: '365', label: '1 year' },
  { value: 'never', label: 'Never' },
] as const

export function TokensPage() {
  const tokens = useQuery(tokensQuery)
  const queryClient = useQueryClient()
  const [creating, setCreating] = useState(false)
  const [created, setCreated] = useState<TokenCreated | null>(null)
  const [revoking, setRevoking] = useState<ApiToken | null>(null)

  const revoke = useMutation({
    mutationFn: (id: string) => api.tokens.revoke(id),
    onSuccess: () => {
      toast.success('Token revoked')
      return queryClient.invalidateQueries({ queryKey: tokensQuery.queryKey })
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  return (
    <Card>
      <CardHeader className="sm:flex sm:items-start sm:justify-between">
        <div className="grid gap-1.5">
          <CardTitle>API tokens</CardTitle>
          <CardDescription>
            Personal tokens access your personal collection and remain tied to your account. Create
            bot tokens under Manage collections. Send tokens as{' '}
            <code className="text-xs">Authorization: Bearer …</code>
          </CardDescription>
        </div>
        <Button className="mt-4 sm:mt-0" onClick={() => setCreating(true)}>
          <PlusIcon /> New token
        </Button>
      </CardHeader>
      <CardContent>
        {tokens.data?.tokens.length === 0 ? (
          <EmptyState>No tokens yet.</EmptyState>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Token</TableHead>
                <TableHead>Scopes</TableHead>
                <TableHead>Last used</TableHead>
                <TableHead>Expires</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {tokens.data?.tokens.map((token) => {
                const expired =
                  token.expires_at !== null && new Date(token.expires_at) <= new Date()
                return (
                  <TableRow key={token.id}>
                    <TableCell className="font-medium">{token.name}</TableCell>
                    <TableCell>
                      <code className="text-xs">{token.prefix}…</code>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {token.scopes.map((s) => (
                          <Badge key={s} variant="secondary">
                            {s}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {relativeTime(token.last_used_at)}
                    </TableCell>
                    <TableCell className={expired ? 'text-destructive' : 'text-muted-foreground'}>
                      {token.expires_at
                        ? expired
                          ? 'expired'
                          : relativeTime(token.expires_at)
                        : 'never'}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="outline" size="sm" onClick={() => setRevoking(token)}>
                        Revoke
                      </Button>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <CreateTokenDialog
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(token) => {
          setCreating(false)
          setCreated(token)
        }}
      />
      <CreatedTokenDialog token={created} onClose={() => setCreated(null)} />
      <ConfirmDialog
        open={revoking !== null}
        onOpenChange={(open) => !open && setRevoking(null)}
        title={`Revoke “${revoking?.name}”?`}
        description="Anything using this token stops working immediately. This can't be undone."
        confirmLabel="Revoke"
        destructive
        onConfirm={() => revoking && revoke.mutate(revoking.id)}
      />
    </Card>
  )
}

function CreateTokenDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean
  onClose: () => void
  onCreated: (token: TokenCreated) => void
}) {
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [scopes, setScopes] = useState<Scope[]>(DEFAULT_TOKEN_SCOPES)
  const [expiry, setExpiry] = useState<(typeof EXPIRY_OPTIONS)[number]['value']>('90')
  const [error, setError] = useState<string | null>(null)

  const create = useMutation({
    mutationFn: () =>
      api.tokens.create({
        name: name.trim(),
        scopes,
        expires_at:
          expiry === 'never'
            ? null
            : new Date(Date.now() + Number(expiry) * 86_400_000).toISOString(),
      }),
    onSuccess: async (token) => {
      await queryClient.invalidateQueries({ queryKey: tokensQuery.queryKey })
      setName('')
      setScopes(DEFAULT_TOKEN_SCOPES)
      setExpiry('90')
      onCreated(token)
    },
    onError: (err) => setError(errorMessage(err)),
  })

  function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!name.trim()) return setError('Give the token a name')
    if (scopes.length === 0) return setError('Pick at least one scope')
    create.mutate()
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New API token</DialogTitle>
          <DialogDescription>Grant only what the script needs.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4" noValidate>
          {error && <Alert variant="destructive">{error}</Alert>}
          <Field id="token-name" label="Name">
            <Input
              id="token-name"
              placeholder="e.g. ci-pipeline"
              maxLength={100}
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </Field>
          <fieldset className="grid gap-3">
            <legend className="mb-2 text-sm font-medium">Scopes</legend>
            {SCOPES.map((scope) => (
              <div key={scope} className="flex items-start gap-2">
                <Checkbox
                  id={`scope-${scope}`}
                  checked={scopes.includes(scope)}
                  onCheckedChange={(checked) =>
                    setScopes((s) =>
                      checked === true ? [...s, scope] : s.filter((x) => x !== scope),
                    )
                  }
                />
                <Label htmlFor={`scope-${scope}`} className="grid gap-1 font-normal">
                  <code className="text-xs font-medium">{scope}</code>
                  <span className="text-muted-foreground">{SCOPE_DESCRIPTIONS[scope]}</span>
                </Label>
              </div>
            ))}
          </fieldset>
          <Field id="token-expiry" label="Expires">
            <NativeSelect
              id="token-expiry"
              value={expiry}
              onChange={(e) => setExpiry(e.target.value as typeof expiry)}
            >
              {EXPIRY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={create.isPending}>
              Create token
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function CreatedTokenDialog({
  token,
  onClose,
}: {
  token: TokenCreated | null
  onClose: () => void
}) {
  async function copy() {
    if (!token) return
    try {
      await navigator.clipboard.writeText(token.token)
      toast.success('Copied to clipboard')
    } catch {
      toast.error('Copy failed. Select the token and copy it manually.')
    }
  }

  return (
    <Dialog open={token !== null}>
      <DialogContent
        showClose={false}
        onEscapeKeyDown={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Token “{token?.name}” created</DialogTitle>
          <DialogDescription>Copy it now and store it somewhere safe.</DialogDescription>
        </DialogHeader>
        <Alert variant="warning" className="font-medium">
          This is the only time you'll see this token. If you lose it, revoke it and create a new
          one.
        </Alert>
        <div className="flex items-center gap-2">
          <code
            data-testid="new-token"
            className="flex-1 rounded-md border bg-muted px-3 py-2 text-xs break-all select-all"
          >
            {token?.token}
          </code>
          <Button variant="outline" size="icon" onClick={copy} aria-label="Copy token">
            <CopyIcon />
          </Button>
        </div>
        <DialogFooter>
          <Button onClick={onClose}>I've saved it</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
