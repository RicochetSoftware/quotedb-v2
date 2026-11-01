import { Button } from '@quotedb/ui'
import { WEB_URL } from '../api'

export function ForbiddenPage() {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-4 p-4 text-center">
      <h1 className="text-2xl font-semibold">No admin access</h1>
      <p className="max-w-sm text-muted-foreground">
        You're signed in, but your account isn't an admin. Ask a super admin if you need access.
      </p>
      <Button variant="outline" asChild>
        <a href={WEB_URL}>Go to QuoteDB</a>
      </Button>
    </div>
  )
}
