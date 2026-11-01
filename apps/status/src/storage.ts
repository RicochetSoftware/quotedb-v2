import type { Env } from './env'
import { components, DAY, interval, type Observation, reduce, type State } from './model'
export async function loadStates(env: Env) {
  const rows = await env.DB.prepare('SELECT data FROM component_state').all<{ data: string }>()
  return rows.results.map((row) => JSON.parse(row.data) as State)
}
export async function commit(
  env: Env,
  bucket: number,
  observations: Observation[],
  previous: State[],
) {
  const token = crypto.randomUUID()
  const at = observations[0]?.at ?? Date.now()
  const last = previous.length ? Math.max(...previous.map((s) => Math.floor(s.at / 60000))) : -1
  // Compare-and-swap the whole generation. All statements share one D1 transaction.
  const guard = 'EXISTS(SELECT 1 FROM evaluations WHERE token=?)'
  const statements = [
    env.DB.prepare(`INSERT INTO evaluations SELECT ?,?,? WHERE
    COALESCE((SELECT MAX(bucket) FROM evaluations),-1)=? AND ?>?`).bind(
      bucket,
      token,
      at,
      last,
      bucket,
      last,
    ),
  ]
  const states: State[] = []
  const rollups: {
    component: string
    day: number
    available: number
    unavailable: number
    degraded: number
    maintenance: number
  }[] = []
  for (const observation of observations) {
    const old = previous.find((s) => s.component === observation.component)
    const state = reduce(old, observation)
    states.push(state)
    const id = `${state.component}-${bucket}`
    if (old) {
      for (const { day, totals } of interval(old.observation, at))
        rollups.push({ component: state.component, day, ...totals })
    }
    if (state.status === 'down' || state.status === 'degraded') {
      statements.push(
        env.DB.prepare(`INSERT INTO incidents SELECT ?,?,?,?,?,NULL WHERE ${guard}
        ON CONFLICT(component) WHERE resolved_at IS NULL DO UPDATE SET severity=excluded.severity`).bind(
          id,
          state.component,
          state.firstFailure ?? old?.at ?? at,
          at,
          state.status,
          token,
        ),
      )
    } else if (
      state.status === 'operational' &&
      state.healthy >= 3 &&
      old?.status !== 'operational'
    ) {
      statements.push(
        env.DB.prepare(
          `UPDATE incidents SET resolved_at=? WHERE component=? AND resolved_at IS NULL AND ${guard}`,
        ).bind(at, state.component, token),
      )
    }
    if (
      state.status !== old?.status &&
      ['operational', 'down', 'degraded'].includes(state.status)
    ) {
      statements.push(
        env.DB.prepare(`INSERT INTO incident_events SELECT ?,id,?,?,NULL FROM incidents WHERE component=?
        AND (resolved_at IS NULL OR resolved_at=?) AND ${guard}`).bind(
          id,
          at,
          state.status,
          state.component,
          at,
          token,
        ),
      )
    }
  }
  // JSON table expansion keeps the D1 binding/response overhead bounded to three writes.
  statements.push(
    env.DB.prepare(`INSERT INTO check_results
      SELECT json_extract(value,'$.component'),?,json_extract(value,'$.at'),
        json_extract(value,'$.observation.duration'),json_extract(value,'$.observation.outcome'),
        json_extract(value,'$.observation.reason') FROM json_each(?) WHERE ${guard}`).bind(
      bucket,
      JSON.stringify(states),
      token,
    ),
    env.DB.prepare(`INSERT INTO component_state SELECT json_extract(value,'$.component'),value
      FROM json_each(?) WHERE ${guard}
      ON CONFLICT(component) DO UPDATE SET data=excluded.data`).bind(JSON.stringify(states), token),
    env.DB.prepare(`INSERT INTO daily_rollups
      SELECT json_extract(value,'$.component'),json_extract(value,'$.day'),
        json_extract(value,'$.available'),json_extract(value,'$.unavailable'),
        json_extract(value,'$.degraded'),json_extract(value,'$.maintenance')
      FROM json_each(?) WHERE ${guard}
      ON CONFLICT(component,day) DO UPDATE SET available=available+excluded.available,
      unavailable=unavailable+excluded.unavailable,degraded=degraded+excluded.degraded,
      maintenance=maintenance+excluded.maintenance`).bind(JSON.stringify(rollups), token),
  )
  const transitions = states.filter(
    (s) =>
      s.status !== previous.find((p) => p.component === s.component)?.status &&
      ['operational', 'down', 'degraded'].includes(s.status),
  )
  if (transitions.length && env.ALERT_URL)
    statements.push(
      env.DB.prepare(`INSERT INTO notification_outbox(id,kind,payload,next_retry)
    SELECT ?,'alert',?,? WHERE ${guard}`).bind(
        `alert-${bucket}`,
        JSON.stringify({
          id: `alert-${bucket}`,
          at,
          components: transitions.map((s) => ({ component: s.component, status: s.status })),
        }),
        at,
        token,
      ),
    )
  if (env.OTLP_URL)
    statements.push(
      env.DB.prepare(`INSERT INTO notification_outbox(id,kind,payload,next_retry)
    SELECT ?,'metrics',?,? WHERE ${guard}`).bind(
        `metrics-${bucket}`,
        JSON.stringify(
          states.map((s) => ({
            component: s.component,
            status: s.status,
            at: s.at,
            duration: s.observation.duration,
            heartbeatAge: s.observation.heartbeatAge ?? null,
            failed: s.observation.outcome === 'failed',
          })),
        ),
        at,
        token,
      ),
    )
  // Immutable start marker also exists before the first summary refresh.
  statements.push(
    env.DB.prepare(`INSERT OR IGNORE INTO summary SELECT 1,?,?,? WHERE ${guard}`).bind(
      at,
      0,
      '{}',
      token,
    ),
  )
  const results = await env.DB.batch(statements)
  return { committed: !!results[0]?.meta.changes, states }
}
export async function prune(env: Env, now: number) {
  // Bounded deletes; boot IDs deliberately persist to prevent old-boot replays.
  await env.DB.batch([
    env.DB.prepare(
      'DELETE FROM check_results WHERE rowid IN (SELECT rowid FROM check_results WHERE observed_at<? LIMIT 100)',
    ).bind(now - 14 * DAY),
    env.DB.prepare(
      'DELETE FROM evaluations WHERE bucket IN (SELECT bucket FROM evaluations WHERE bucket<? LIMIT 20)',
    ).bind(Math.floor((now - 14 * DAY) / 60000)),
    env.DB.prepare(
      'DELETE FROM daily_rollups WHERE rowid IN (SELECT rowid FROM daily_rollups WHERE day<? LIMIT 10)',
    ).bind(now - 401 * DAY),
    env.DB.prepare(
      'DELETE FROM notification_outbox WHERE id IN (SELECT id FROM notification_outbox WHERE delivered_at<? LIMIT 20)',
    ).bind(now - DAY),
    env.DB.prepare(
      'DELETE FROM notification_outbox WHERE id IN (SELECT id FROM notification_outbox WHERE delivered_at IS NULL AND next_retry<? AND attempts>=6 LIMIT 20)',
    ).bind(now - DAY),
    env.DB.prepare(
      'DELETE FROM incident_events WHERE incident_id IN (SELECT id FROM incidents WHERE resolved_at<? LIMIT 5)',
    ).bind(now - 366 * DAY),
    env.DB.prepare(
      'DELETE FROM incidents WHERE id IN (SELECT id FROM incidents WHERE resolved_at<? LIMIT 5)',
    ).bind(now - 366 * DAY),
  ])
}
export { components }
