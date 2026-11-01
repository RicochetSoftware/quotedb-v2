import type { Collection } from '@quotedb/shared'
import { NativeSelect } from '@quotedb/ui'
import { useQuery } from '@tanstack/react-query'
import { Link, Outlet } from '@tanstack/react-router'
import { createContext, type ReactNode, useContext, useState } from 'react'
import { api, errorMessage } from '../api'

export const collectionsQuery = { queryKey: ['collections'], queryFn: () => api.collections.list() }
const Context = createContext<{
  collection: Collection | undefined
  collections: Collection[]
  select: (id: string) => void
  pending: boolean
  error: unknown
}>({ collection: undefined, collections: [], select: () => {}, pending: true, error: null })

export function CollectionProvider({ userId, children }: { userId?: string; children: ReactNode }) {
  const query = useQuery({ ...collectionsQuery, enabled: !!userId })
  const [selected, setSelected] = useState(() =>
    userId ? localStorage.getItem(`collection:${userId}`) : null,
  )
  const collections = query.data?.collections ?? []
  const collection =
    collections.find((c) => c.id === selected) ??
    collections.find((c) => c.kind === 'personal') ??
    collections[0]
  function select(id: string) {
    setSelected(id)
    if (userId) localStorage.setItem(`collection:${userId}`, id)
  }
  return (
    <Context.Provider
      value={{ collection, collections, select, pending: query.isPending, error: query.error }}
    >
      {children}
    </Context.Provider>
  )
}
export const useCollection = () => useContext(Context)
export function CollectionPicker() {
  const { collection, collections, select, pending, error } = useCollection()
  if (error)
    return (
      <p role="alert" className="mb-6 text-destructive">
        Could not load collections: {errorMessage(error)}
      </p>
    )
  return (
    <div className="mb-6 flex flex-wrap items-center gap-3 rounded-lg border p-3">
      <label htmlFor="active-collection" className="text-sm font-medium">
        Collection
      </label>
      <NativeSelect
        id="active-collection"
        className="w-auto min-w-48"
        value={collection?.id ?? ''}
        disabled={pending}
        onChange={(e) => select(e.target.value)}
      >
        {pending && <option value="">Loading…</option>}
        {collections.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name} · {c.kind}
          </option>
        ))}
      </NativeSelect>
      {collection && <span className="text-sm text-muted-foreground">{collection.role}</span>}
      <Link to="/collections" className="ml-auto text-sm underline">
        Manage collections
      </Link>
    </div>
  )
}
export function CollectionOutlet() {
  const { collection } = useCollection()
  return <Outlet key={collection?.id ?? 'none'} />
}
