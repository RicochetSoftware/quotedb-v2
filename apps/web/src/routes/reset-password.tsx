import { Button, Card, CardContent, CardHeader, CardTitle } from '@quotedb/ui'
import { Link } from '@tanstack/react-router'

export function ResetPasswordPage() {
  return (
    <Card className="mx-auto mt-8 max-w-sm">
      <CardHeader>
        <CardTitle>Sign in with an email code</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">
        <p>
          QuoteDB no longer uses passwords. Request a sign-in code using your existing account
          email.
        </p>
        <Button asChild>
          <Link to="/login">Go to login</Link>
        </Button>
      </CardContent>
    </Card>
  )
}
