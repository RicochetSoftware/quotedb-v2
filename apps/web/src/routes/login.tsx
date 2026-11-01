import type { CodeChallenge } from '@quotedb/shared'
import {
  Alert,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Field,
  Input,
} from '@quotedb/ui'
import { useQueryClient } from '@tanstack/react-query'
import { useRouter, useSearch } from '@tanstack/react-router'
import { type FormEvent, useEffect, useState } from 'react'
import { api, errorMessage, meQuery } from '../api'

export function LoginPage() {
  const search = useSearch({ from: '/login' })
  const router = useRouter()
  const queryClient = useQueryClient()
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [challenge, setChallenge] = useState<CodeChallenge | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [retryAt, setRetryAt] = useState(0)
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  const remaining = Math.max(0, Math.ceil((retryAt - now) / 1000))

  async function requestCode() {
    setBusy(true)
    setError(null)
    try {
      const normalized = email.trim().toLowerCase()
      const next = await api.auth.requestCode({ email: normalized })
      setEmail(normalized)
      setChallenge(next)
      setCode('')
      setRetryAt(Date.now() + next.retry_after * 1000)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!challenge) return requestCode()
    setBusy(true)
    setError(null)
    try {
      const me = await api.auth.verifyCode({ challenge_id: challenge.challenge_id, code })
      queryClient.setQueryData(meQuery.queryKey, me)
      router.history.push(search.redirect ?? '/quotes')
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="mx-auto mt-8 max-w-sm">
      <CardHeader>
        <CardTitle className="text-xl">Log in</CardTitle>
        <CardDescription>
          {challenge
            ? `If ${email} has an active account, a code is on its way. Codes expire in 10 minutes.`
            : 'Sign in with an email code. An existing account or invitation is required.'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="grid gap-4">
          {error && <Alert variant="destructive">{error}</Alert>}
          {challenge ? (
            <Field id="code" label="Sign-in code">
              <Input
                key="code"
                id="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                maxLength={6}
                autoFocus
                required
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              />
            </Field>
          ) : (
            <Field id="email" label="Email">
              <Input
                key="email"
                id="email"
                type="email"
                autoComplete="email"
                autoFocus
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </Field>
          )}
          <Button type="submit" disabled={busy}>
            {busy ? 'Please wait…' : challenge ? 'Verify and log in' : 'Send sign-in code'}
          </Button>
          {challenge && (
            <>
              <Button
                type="button"
                variant="outline"
                disabled={busy || remaining > 0}
                onClick={() => void requestCode()}
              >
                {remaining > 0 ? `Resend in ${remaining}s` : 'Resend code'}
              </Button>
              <Button
                type="button"
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  setChallenge(null)
                  setCode('')
                  setError(null)
                }}
              >
                Use a different email
              </Button>
            </>
          )}
        </form>
      </CardContent>
    </Card>
  )
}
