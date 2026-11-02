import { STATUS_URL, watchServiceStatus } from '@quotedb/shared'
import { useEffect, useState } from 'react'

export function ServiceNotice() {
  const [message, setMessage] = useState<string | null>(null)
  useEffect(() => watchServiceStatus(setMessage), [])
  return (
    <div role="status" aria-live="polite">
      {message && (
        <aside className="border-b border-yellow-300 bg-yellow-100 text-yellow-950 dark:border-yellow-800 dark:bg-yellow-950 dark:text-yellow-100">
          <div className="mx-auto max-w-4xl px-4 py-3 text-sm">
            {message}{' '}
            <a href={STATUS_URL} className="font-medium underline underline-offset-2">
              View status
            </a>
          </div>
        </aside>
      )}
    </div>
  )
}
