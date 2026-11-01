import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  relativeTime,
  toast,
} from '@quotedb/ui'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, errorMessage, meQuery, sessionsQuery } from '../api'

export function AccountPage() {
  const { data: me } = useQuery(meQuery)
  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
          <CardDescription>Ask an admin to change your name or email.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-1 text-sm">
          <div className="font-medium">{me?.name}</div>
          <div className="text-muted-foreground">{me?.email}</div>
          {me && me.role !== 'USER' && <Badge variant="secondary">{me.role}</Badge>}
        </CardContent>
      </Card>
      <SessionsCard />
    </div>
  )
}

function SessionsCard() {
  const queryClient = useQueryClient()
  const sessions = useQuery(sessionsQuery)
  const others = sessions.data?.sessions.filter((s) => !s.current) ?? []
  const logoutOthers = useMutation({
    mutationFn: () => api.auth.logoutOthers(),
    onSuccess: () => {
      toast.success('Signed out of other sessions')
      return queryClient.invalidateQueries({ queryKey: sessionsQuery.queryKey })
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sessions</CardTitle>
        <CardDescription>Browsers where you're signed in.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <ul className="divide-y rounded-md border text-sm">
          {sessions.data?.sessions.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
              <span className="max-w-full truncate">{s.user_agent ?? 'Unknown device'}</span>
              {s.current && <Badge variant="secondary">This browser</Badge>}
              <span className="ml-auto text-muted-foreground">
                {s.ip} · active {relativeTime(s.last_seen_at ?? s.created_at)}
              </span>
            </li>
          ))}
        </ul>
        <Button
          variant="outline"
          className="w-fit"
          disabled={others.length === 0 || logoutOthers.isPending}
          onClick={() => logoutOthers.mutate()}
        >
          Sign out other sessions
        </Button>
      </CardContent>
    </Card>
  )
}
