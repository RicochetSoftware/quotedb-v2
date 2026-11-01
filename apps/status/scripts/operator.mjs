// Input is a reviewed JSON file; credentials remain in the environment.
import { readFile } from 'node:fs/promises'

const [file] = process.argv.slice(2)
if (!file || !process.env.STATUS_OPERATOR_SECRET)
  throw new Error('Usage: STATUS_OPERATOR_SECRET=... pnpm operator operation.json')
const body = await readFile(file, 'utf8')
JSON.parse(body)
const response = await fetch(
  new URL('/operator', process.env.STATUS_URL || 'https://status.quotes.elmu.dev'),
  {
    method: 'POST',
    redirect: 'error',
    signal: AbortSignal.timeout(10000),
    headers: {
      authorization: `Bearer ${process.env.STATUS_OPERATOR_SECRET}`,
      'content-type': 'application/json',
    },
    body,
  },
)
if (!response.ok) throw new Error(`Operation failed: HTTP ${response.status}`)
console.log('Operation recorded.')
