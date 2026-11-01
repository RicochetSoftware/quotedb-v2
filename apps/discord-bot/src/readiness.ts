import { randomUUID } from 'node:crypto'
export interface Readiness {
  ready: boolean
  db: boolean
  api: boolean
  discord: boolean
  latency: number | null
}
export function readinessChecker(dependencies: {
  database: () => Promise<unknown>
  apiUrl: string
  discord: () => boolean
  latency: () => number
}) {
  let pending: Promise<Readiness> | undefined
  return () => {
    if (pending) return pending
    pending = (async () => {
      let timer: ReturnType<typeof setTimeout> | undefined
      const dbCheck = Promise.race([
        dependencies.database(),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('timeout')), 3000)
        }),
      ]).finally(() => clearTimeout(timer))
      const [dbResult, apiResult] = await Promise.allSettled([
        dbCheck,
        fetch(`${dependencies.apiUrl}/healthz`, {
          redirect: 'error',
          signal: AbortSignal.timeout(3000),
        }).then(async (r) => r.ok && ((await r.json()) as { ok?: boolean }).ok === true),
      ])
      const db = dbResult.status === 'fulfilled'
      const api = apiResult.status === 'fulfilled' && apiResult.value
      const discord = dependencies.discord()
      const value = dependencies.latency()
      return {
        ready: db && api && discord,
        db,
        api,
        discord,
        latency: Number.isFinite(value) && value >= 0 ? value : null,
      }
    })().finally(() => {
      pending = undefined
    })
    return pending
  }
}
export function startHeartbeat(
  check: () => Promise<Readiness>,
  report: (health: Readiness) => void,
  url = process.env.STATUS_HEARTBEAT_URL,
  secret = process.env.STATUS_HEARTBEAT_SECRET,
) {
  if (url && (!secret || secret.length < 32 || new URL(url).protocol !== 'https:'))
    throw new Error('Heartbeat requires HTTPS and a 32-character secret')
  const boot = randomUUID()
  let sequence = 0
  let active = false
  let stopped = false
  const abort = new AbortController()
  const tick = async () => {
    if (active || stopped) return
    active = true
    try {
      const health = await check()
      if (stopped) return
      report(health)
      if (url && secret) {
        const response = await fetch(url, {
          method: 'POST',
          redirect: 'error',
          signal: AbortSignal.any([abort.signal, AbortSignal.timeout(5000)]),
          headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' },
          body: JSON.stringify({ id: randomUUID(), boot, sequence: sequence++, ...health }),
        })
        await response.body?.cancel()
        if (!response.ok) console.warn('heartbeat_delivery_failed')
      }
    } catch {
      if (!stopped) console.warn('heartbeat_delivery_failed')
    } finally {
      active = false
    }
  }
  const timer = setInterval(() => void tick(), 30000)
  timer.unref()
  void tick()
  return () => {
    stopped = true
    clearInterval(timer)
    abort.abort()
  }
}
