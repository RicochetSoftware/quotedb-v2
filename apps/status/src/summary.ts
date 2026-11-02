import type { Env } from './env'
import { availability, components, DAY, interval, type State, type Totals } from './model'

interface Row extends Totals {
  component: string
  day: number
}
const empty = (): Totals => ({ available: 0, unavailable: 0, degraded: 0, maintenance: 0 })
function add(a: Totals, b: Totals) {
  for (const key of [
    'available',
    'unavailable',
    'degraded',
    'maintenance',
    'maintenance_available',
    'maintenance_unavailable',
  ] as const)
    a[key] = (a[key] ?? 0) + (b[key] ?? 0)
}
export async function summarize(env: Env, now: number) {
  const marker = await env.DB.prepare(
    'SELECT started_at,updated_at FROM summary WHERE id=1',
  ).first<{ started_at: number; updated_at: number }>()
  if (!marker || (marker.updated_at !== 0 && now - marker.updated_at < 1800000)) return
  const [days, checks, latest] = await env.DB.batch([
    env.DB.prepare('SELECT * FROM daily_rollups WHERE day>=?').bind(
      Math.floor(now / DAY) * DAY - 89 * DAY,
    ),
    env.DB.prepare(`WITH ordered AS (
      SELECT component,outcome,reason,observed_at,
        LEAD(observed_at,1,?) OVER(PARTITION BY component ORDER BY observed_at) AS next_at
      FROM check_samples WHERE observed_at>=?
    ), spans AS (
      SELECT component,outcome,reason,MAX(0,MIN(next_at,observed_at+180000,?)-MAX(observed_at,?))/1000.0 AS seconds FROM ordered
    ) SELECT component,
      SUM(CASE WHEN outcome IN ('healthy','slow') THEN seconds ELSE 0 END) AS available,
      SUM(CASE WHEN outcome='failed' THEN seconds ELSE 0 END) AS unavailable,
      SUM(CASE WHEN outcome='slow' THEN seconds ELSE 0 END) AS degraded,
      SUM(CASE WHEN outcome='maintenance' THEN seconds ELSE 0 END) AS maintenance,
      SUM(CASE WHEN outcome='maintenance' AND reason IN ('maintenance:healthy','maintenance:slow') THEN seconds ELSE 0 END) AS maintenance_available,
      SUM(CASE WHEN outcome='maintenance' AND reason='maintenance:failed' THEN seconds ELSE 0 END) AS maintenance_unavailable
    FROM spans GROUP BY component`).bind(now, now - DAY - 180000, now, now - DAY),
    env.DB.prepare('SELECT data FROM component_state'),
  ])
  const rows = days?.results as unknown as Row[]
  const recentRows = checks?.results as unknown as (Totals & { component: string })[]
  const states = ((latest?.results ?? []) as { data: string }[]).map(
    (row) => JSON.parse(row.data) as State,
  )

  const data = Object.fromEntries(
    components.map((component) => {
      const history = rows.filter((row) => row.component === component)
      const last = states.find((state) => state.component === component)?.observation
      const recent = recentRows.find((row) => row.component === component) ?? empty()
      if (last)
        for (const part of interval(last, now)) {
          const existing = history.find((row) => row.day === part.day)
          if (existing) add(existing, part.totals)
          else history.push({ component, day: part.day, ...part.totals })
        }
      const windows = [30, 90].map((count) => {
        const start = Math.floor(now / DAY) * DAY - (count - 1) * DAY
        const total = empty()
        for (const row of history) if (row.day >= start) add(total, row)
        return availability(total, Math.max(0, now - Math.max(marker.started_at, start)) / 1000)
      })
      return [
        component,
        {
          windows: [
            availability(recent, Math.min(DAY, now - marker.started_at) / 1000),
            ...windows,
          ],
          days: Array.from({ length: 90 }, (_, i) => {
            const day = Math.floor(now / DAY) * DAY - (89 - i) * DAY
            const total = history.find((row) => row.day === day) ?? empty()
            return {
              day,
              ...availability(
                total,
                Math.max(0, Math.min(now, day + DAY) - Math.max(day, marker.started_at)) / 1000,
              ),
            }
          }),
        },
      ]
    }),
  )
  await env.DB.prepare('UPDATE summary SET updated_at=?,data=? WHERE id=1 AND updated_at<?')
    .bind(now, JSON.stringify(data), now)
    .run()
}
