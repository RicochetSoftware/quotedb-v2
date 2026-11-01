import type { Env } from './env'
import type { Component, Status } from './model'

interface Measurement {
  component: Component
  status: Status
  at: number
  duration: number | null
  heartbeatAge?: number | null
  failed: boolean
}
export function otlp(rows: Measurement[]) {
  const metric = (name: string, value: (row: Measurement) => number | null) => ({
    name,
    gauge: {
      dataPoints: rows
        .filter((row) => value(row) !== null)
        .map((row) => ({
          attributes: [{ key: 'component', value: { stringValue: row.component } }],
          timeUnixNano: String(BigInt(row.at) * 1_000_000n),
          asDouble: value(row),
        })),
    },
  })
  return {
    resourceMetrics: [
      {
        resource: {
          attributes: [{ key: 'service.name', value: { stringValue: 'quotedb-status' } }],
        },
        scopeMetrics: [
          {
            scope: { name: 'quotedb' },
            metrics: [
              metric(
                'quotedb_component_state',
                (row) =>
                  ({ operational: 0, degraded: 1, down: 2, unknown: 3, maintenance: 4 })[
                    row.status
                  ],
              ),
              metric('quotedb_probe_duration_milliseconds', (row) => row.duration),
              metric('quotedb_bot_heartbeat_age_seconds', (row) => row.heartbeatAge ?? null),
              metric('quotedb_probe_failed', (row) => Number(row.failed)),
              metric('quotedb_evaluation_timestamp_seconds', (row) => row.at / 1000),
            ],
          },
        ],
      },
    ],
  }
}
export async function deliver(env: Env, now: number) {
  // Current gauges take precedence over backfill after an exporter outage.
  // Transition alerts retain FIFO priority; no telemetry backlog delays them.
  const pending = await env.DB.prepare(
    "SELECT id,kind,payload,attempts FROM notification_outbox WHERE delivered_at IS NULL AND next_retry<=? AND attempts<6 ORDER BY CASE WHEN kind='alert' THEN 0 ELSE 1 END,CASE WHEN kind='alert' THEN next_retry END,id DESC LIMIT 2",
  )
    .bind(now)
    .all<{ id: string; kind: string; payload: string; attempts: number }>()
  for (const item of pending.results) {
    // Lease via CAS protects overlapping maintenance calls. Destination should deduplicate alert IDs.
    const claim = await env.DB.prepare(
      'UPDATE notification_outbox SET attempts=attempts+1,next_retry=? WHERE id=? AND attempts=? AND delivered_at IS NULL',
    )
      .bind(now + Math.min(3600000, 60000 * 2 ** item.attempts), item.id, item.attempts)
      .run()
    if (!claim.meta.changes) continue
    const url = item.kind === 'metrics' ? env.OTLP_URL : env.ALERT_URL
    const auth = item.kind === 'metrics' ? env.OTLP_AUTH : env.ALERT_AUTH
    if (!url || !auth) continue
    let httpStatus: number | undefined
    let phase = 'serialize'
    try {
      const body =
        item.kind === 'metrics' ? JSON.stringify(otlp(JSON.parse(item.payload))) : item.payload
      phase = 'fetch'
      const response = await fetch(url, {
        method: 'POST',
        redirect: 'manual',
        signal: AbortSignal.timeout(5000),
        headers: {
          Authorization: auth,
          'Content-Type': 'application/json',
          'Idempotency-Key': item.id,
        },
        body,
      })
      phase = 'response'
      httpStatus = response.status
      await response.body?.cancel()
      if (!response.ok) throw new Error('export')
      phase = 'acknowledge'
      await env.DB.prepare('UPDATE notification_outbox SET delivered_at=? WHERE id=?')
        .bind(now, item.id)
        .run()
    } catch (error) {
      console.warn(
        JSON.stringify({
          event: 'delivery_failed',
          kind: item.kind,
          attempt: item.attempts + 1,
          httpStatus,
          phase,
          errorType: error instanceof Error ? error.name : 'unknown',
        }),
      )
    }
  }
}
