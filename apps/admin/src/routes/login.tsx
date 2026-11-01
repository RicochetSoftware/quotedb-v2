import { Button, Card, CardContent, CardHeader, CardTitle } from '@quotedb/ui'

export function LoginPage() {
  return (
    <Card className="mx-auto mt-8 max-w-sm">
      <CardHeader>
        <CardTitle>Admin access required</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">
        <p>
          Sign in through Cloudflare Access with an email belonging to an active QuoteDB
          administrator.
        </p>
        <Button onClick={() => window.location.assign('/')}>Try again</Button>
        <Button variant="outline" onClick={() => window.location.assign('/cdn-cgi/access/logout')}>
          Use another account
        </Button>
      </CardContent>
    </Card>
  )
}
