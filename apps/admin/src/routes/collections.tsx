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
import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate, useSearch } from '@tanstack/react-router'
import { allCollectionsQuery, errorMessage } from '../api'
import { PageHeader } from '../components/layout'

export function CollectionsPage() {
  const search = useSearch({ from: '/authed/collections' })
  const navigate = useNavigate({ from: '/collections' })
  const collections = useQuery(allCollectionsQuery)
  const query = search.q?.trim().toLocaleLowerCase() ?? ''
  const filtered =
    collections.data?.collections.filter(
      (collection) =>
        (!search.kind || collection.kind === search.kind) &&
        collection.name.toLocaleLowerCase().includes(query),
    ) ?? []

  return (
    <>
      <PageHeader title="Collections" />
      <Card className="py-4">
        <CardContent className="px-4">
          <div className="mb-4 flex flex-col gap-2 sm:flex-row">
            <Input
              aria-label="Search collections"
              placeholder="Search collections…"
              value={search.q ?? ''}
              onChange={(event) =>
                void navigate({
                  search: { ...search, q: event.target.value || undefined },
                  replace: true,
                })
              }
            />
            <NativeSelect
              aria-label="Collection type"
              className="sm:w-44"
              value={search.kind ?? ''}
              onChange={(event) =>
                void navigate({
                  search: {
                    ...search,
                    kind: (event.target.value || undefined) as typeof search.kind,
                  },
                  replace: true,
                })
              }
            >
              <option value="">All types</option>
              <option value="personal">Personal</option>
              <option value="shared">Shared</option>
            </NativeSelect>
          </div>
          {collections.isPending ? (
            <Skeleton className="h-40" />
          ) : collections.isError ? (
            <EmptyState>Could not load collections: {errorMessage(collections.error)}</EmptyState>
          ) : filtered.length === 0 ? (
            <EmptyState>No collections match.</EmptyState>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Quotes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((collection) => (
                  <TableRow key={collection.id}>
                    <TableCell className="font-medium">
                      <Link
                        to="/collections/$id"
                        params={{ id: collection.id }}
                        className="hover:underline"
                      >
                        {collection.name}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Badge variant={collection.kind === 'shared' ? 'secondary' : 'outline'}>
                        {collection.kind === 'shared' ? 'Shared' : 'Personal'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="outline" size="sm" asChild>
                        <Link
                          to="/quotes"
                          search={{ collection_id: collection.id }}
                          aria-label={`View quotes in ${collection.name}`}
                        >
                          View quotes
                        </Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {collections.data && (
            <p className="mt-4 text-sm text-muted-foreground">
              {filtered.length} of {collections.data.collections.length} collections
            </p>
          )}
        </CardContent>
      </Card>
    </>
  )
}
