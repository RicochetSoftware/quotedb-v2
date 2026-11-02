export const STATUS_URL = 'https://status.quotes.elmu.dev'
const names: Record<string, string> = {
  web: 'Web app',
  admin: 'Admin',
  bot: 'Discord bot',
  api: 'API',
  site: 'Website',
}

/** Only fresh, confirmed service problems warrant an outage notice. */
export function serviceNotice(data: unknown, now = Date.now()): string | null {
  if (
    !data ||
    typeof data !== 'object' ||
    !('components' in data) ||
    !Array.isArray(data.components)
  )
    return null
  const problems: string[] = []
  for (const item of data.components) {
    if (
      !item ||
      typeof item !== 'object' ||
      typeof item.component !== 'string' ||
      !Object.hasOwn(names, item.component)
    )
      continue
    if (
      typeof item.lastCheck !== 'number' ||
      !Number.isFinite(item.lastCheck) ||
      now - item.lastCheck > 180000 ||
      item.lastCheck > now + 60000
    )
      continue
    if (item.status === 'down') problems.push(`${names[item.component]} is unavailable`)
    if (item.status === 'degraded')
      problems.push(`${names[item.component]} is experiencing degraded performance`)
  }
  return problems.length ? `${problems.join('; ')}.` : null
}

export function watchServiceStatus(update: (message: string | null) => void): () => void {
  let stopped = false
  let controller: AbortController | undefined
  async function refresh() {
    controller?.abort()
    if (document.hidden || stopped) return
    const request = new AbortController()
    controller = request
    const timeout = setTimeout(() => request.abort(), 5000)
    try {
      const response = await fetch(`${STATUS_URL}/api/notice`, {
        credentials: 'omit',
        signal: request.signal,
      })
      if (!response.ok) throw new Error('Status unavailable')
      const data: unknown = await response.json()
      if (!stopped && controller === request) update(serviceNotice(data))
    } catch {
      if (!stopped && controller === request) update(null)
    } finally {
      clearTimeout(timeout)
    }
  }
  const timer = setInterval(() => void refresh(), 60000)
  document.addEventListener('visibilitychange', refresh)
  void refresh()
  return () => {
    stopped = true
    clearInterval(timer)
    controller?.abort()
    document.removeEventListener('visibilitychange', refresh)
  }
}
