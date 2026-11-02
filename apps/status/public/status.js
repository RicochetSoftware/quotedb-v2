const names = { web: 'Web', admin: 'Admin', bot: 'Discord bot', api: 'API', site: 'Site' }
const labels = {
  operational: '✓ Operational',
  degraded: '△ Elevated latency',
  down: '✕ Unavailable',
  unknown: '◷ Unknown',
  maintenance: '◷ Maintenance',
}
const date = (value) => new Date(value).toLocaleString()
const pct = (value) => (value === null ? 'No data' : `${value.toFixed(2)}%`)
const minutes = (seconds) => (seconds > 0 && seconds < 60 ? '<1m' : `${Math.round(seconds / 60)}m`)
function node(tag, text, className) {
  const element = document.createElement(tag)
  if (text !== undefined) element.textContent = text
  if (className) element.className = className
  return element
}
let last
function render(data, failed = false) {
  const now = Date.now()
  const stale =
    failed || data.stale || data.components.some((c) => !c.lastCheck || now - c.lastCheck > 180000)
  const affected = data.components.filter((c) => ['down', 'degraded'].includes(c.status))
  const banner = document.getElementById('banner')
  const severity = stale
    ? 'unknown'
    : affected.some((c) => c.status === 'down')
      ? 'down'
      : affected.length
        ? 'degraded'
        : data.components.some((c) => c.status === 'unknown')
          ? 'unknown'
          : data.components.some((c) => c.status === 'maintenance')
            ? 'maintenance'
            : 'operational'
  banner.className = `banner ${severity}`
  banner.replaceChildren(
    node(
      'div',
      stale
        ? '◷ Monitoring unavailable or stale'
        : affected.length
          ? 'Service disruption'
          : severity === 'operational'
            ? '✓ All services operational'
            : labels[severity],
    ),
  )
  if (affected.length) {
    const list = node('ul')
    for (const c of affected)
      list.append(
        node(
          'li',
          `${names[c.component]} — ${labels[c.status]}${stale ? ' (last confirmed)' : ''}`,
          c.status,
        ),
      )
    banner.append(list)
  }
  document.getElementById('freshness').textContent = stale
    ? 'Current availability cannot be confirmed. Prior unresolved incidents remain below.'
    : `Latest observation: ${date(Math.min(...data.components.map((c) => c.lastCheck)))} · refreshes every 30 seconds`
  const cards = document.getElementById('components')
  cards.replaceChildren()
  for (const c of data.components) {
    const card = node('article', undefined, 'card')
    const row = node('div', undefined, 'row')
    row.append(
      node('h2', names[c.component]),
      node('span', labels[stale ? 'unknown' : c.status], stale ? 'unknown' : c.status),
    )
    card.append(row)
    if (c.dependency) card.append(node('p', 'Affected by API availability.', 'detail'))
    const windows = node('div', undefined, 'windows')
    for (const [i, label] of ['24 hours', '30 days', '90 days'].entries()) {
      const w = c.history?.windows[i]
      const item = node('div', label, 'window')
      item.append(node('strong', w ? pct(w.percent) : 'No data'))
      if (w)
        item.append(
          node('div', `${(w.coverage * 100).toFixed(1)}% coverage`, 'detail'),
          node(
            'div',
            `${minutes(w.downtime ?? w.unavailable)} downtime · ${minutes(w.unknown)} unknown · ${minutes(w.maintenance)} maintenance`,
            'detail',
          ),
        )
      windows.append(item)
    }
    card.append(windows)
    const history = node('div', undefined, 'history')
    for (const d of c.history?.days ?? []) {
      const state =
        d.unavailable > 0
          ? 'down'
          : d.degraded > 0
            ? 'degraded'
            : d.percent === null && d.maintenance === 0
              ? 'unknown'
              : 'operational'
      const bar = node('button', undefined, `day ${state}`)
      bar.type = 'button'
      bar.setAttribute(
        'aria-label',
        `${new Date(d.day).toISOString().slice(0, 10)}: ${pct(d.percent)} available, ${(d.coverage * 100).toFixed(1)}% coverage, ${minutes(d.downtime ?? d.unavailable)} downtime, ${minutes(d.unknown)} unknown, ${minutes(d.maintenance)} maintenance, ${minutes(d.maintenance_unavailable ?? 0)} downtime during maintenance`,
      )
      history.append(bar)
    }
    card.append(history)
    const captions = node('div', undefined, 'history-label')
    captions.append(node('span', '90 days ago'), node('span', 'Today'))
    card.append(captions)
    cards.append(card)
  }
  const incidents = document.getElementById('incidents')
  incidents.replaceChildren()
  for (const incident of data.incidents ?? []) {
    const item = node('article', undefined, 'incident')
    item.append(
      node(
        'strong',
        `${names[incident.component]} — ${incident.resolved_at ? 'Resolved' : 'Unresolved'} service disruption`,
        incident.resolved_at ? '' : incident.severity,
      ),
    )
    item.append(
      node(
        'p',
        `First observed ${date(incident.first_failure_at)} · confirmed ${date(incident.confirmed_at)}${incident.resolved_at ? ` · resolved ${date(incident.resolved_at)}` : ''}`,
        'detail',
      ),
    )
    for (const note of data.notes ?? [])
      if (note.incident_id === incident.id) item.append(node('p', note.note))
    incidents.append(item)
  }
  if (!incidents.childElementCount) incidents.textContent = 'No incidents recorded.'
  const maintenance = document.getElementById('maintenance')
  maintenance.replaceChildren()
  for (const item of data.maintenance ?? [])
    maintenance.append(
      node(
        'p',
        `${names[item.component]} · ${date(item.starts_at)} – ${date(item.ends_at)}: ${item.note}`,
      ),
    )
  if (!maintenance.childElementCount) maintenance.textContent = 'No maintenance scheduled.'
  document.getElementById('started').textContent = data.measurementStart
    ? `Measurements began ${date(data.measurementStart)}. History calculated ${data.historyAt ? date(data.historyAt) : 'after the first observation'}.`
    : 'Measurements have not started.'
}
async function refresh() {
  if (document.hidden) return
  try {
    const response = await fetch('/api/status', {
      cache: 'no-store',
      signal: AbortSignal.timeout(10000),
    })
    if (!response.ok) throw new Error('unavailable')
    last = await response.json()
    render(last)
  } catch {
    render(
      last ?? {
        components: Object.keys(names).map((component) => ({ component, status: 'unknown' })),
        incidents: [],
      },
      true,
    )
  }
}
void refresh()
setInterval(refresh, 30000)
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) void refresh()
})
