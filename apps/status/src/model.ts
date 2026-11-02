export const components = ['web', 'admin', 'bot', 'api', 'site'] as const
export type Component = (typeof components)[number]
export type Status = 'operational' | 'degraded' | 'down' | 'unknown' | 'maintenance'
export type Outcome = 'healthy' | 'slow' | 'failed' | 'unknown' | 'maintenance'
export interface Observation {
  component: Component
  at: number
  duration: number | null
  heartbeatAge?: number | null
  sourceAt?: number
  outcome: Outcome
  reason: string | null
}
export interface State {
  component: Component
  status: Status
  at: number
  failures: number
  healthy: number
  successes: number
  window: boolean[]
  firstFailure: number | null
  lastSuccess: number | null
  observation: Observation
}
export function reduce(previous: State | undefined, observation: Observation): State {
  if (previous && observation.at <= previous.at) return previous
  const gap = !previous || observation.at - previous.at > 180_000
  const old = gap ? undefined : previous
  const { outcome, at } = observation
  const success = outcome === 'healthy' || outcome === 'slow'
  const failures = outcome === 'failed' ? (old?.failures ?? 0) + 1 : 0
  const healthy = outcome === 'healthy' ? (old?.healthy ?? 0) + 1 : 0
  const successes = success ? (old?.successes ?? 0) + 1 : 0
  const window = success
    ? [...(old?.window ?? []), outcome === 'slow'].slice(-5)
    : outcome === 'failed'
      ? (old?.window ?? [])
      : []
  const slow = window.filter(Boolean).length >= 3
  let status: Status = old?.status ?? 'unknown'
  if (outcome === 'unknown' || outcome === 'maintenance') status = outcome
  else if (failures >= 2) status = 'down'
  else if (slow && successes >= 3) status = 'degraded'
  else if (healthy >= 3) status = 'operational'
  // An unresolved incident survives missing telemetry and maintenance until confirmed recovery.
  else if (!old || old.status === 'maintenance') status = 'unknown'
  return {
    component: observation.component,
    status,
    at,
    failures,
    healthy,
    successes,
    window,
    firstFailure: outcome === 'failed' || outcome === 'slow' ? (old?.firstFailure ?? at) : null,
    lastSuccess: success ? at : (previous?.lastSuccess ?? null),
    observation,
  }
}
export function currentStatus(state: State, now: number): Status {
  return now - state.at > 180_000 ? 'unknown' : state.status
}
export const DAY = 86_400_000
export interface Totals {
  available: number
  unavailable: number
  degraded: number
  maintenance: number
  maintenance_available?: number
  maintenance_unavailable?: number
}
export function interval(
  observation: Observation,
  until: number,
): { day: number; totals: Totals }[] {
  const end = Math.min(until, observation.at + 180_000)
  const result: { day: number; totals: Totals }[] = []
  for (let start = observation.at; start < end; ) {
    const day = Math.floor(start / DAY) * DAY
    const next = Math.min(end, day + DAY)
    const seconds = (next - start) / 1000
    result.push({
      day,
      totals: {
        available: ['healthy', 'slow'].includes(observation.outcome) ? seconds : 0,
        unavailable: observation.outcome === 'failed' ? seconds : 0,
        degraded: observation.outcome === 'slow' ? seconds : 0,
        maintenance: observation.outcome === 'maintenance' ? seconds : 0,
        maintenance_available:
          observation.outcome === 'maintenance' &&
          ['maintenance:healthy', 'maintenance:slow'].includes(observation.reason ?? '')
            ? seconds
            : 0,
        maintenance_unavailable:
          observation.outcome === 'maintenance' && observation.reason === 'maintenance:failed'
            ? seconds
            : 0,
      },
    })
    start = next
  }
  return result
}
export function availability(totals: Totals, seconds: number) {
  const available = totals.available + (totals.maintenance_available ?? 0)
  const downtime = totals.unavailable + (totals.maintenance_unavailable ?? 0)
  const measured = available + downtime
  const unmeasuredMaintenance = Math.max(
    0,
    totals.maintenance -
      (totals.maintenance_available ?? 0) -
      (totals.maintenance_unavailable ?? 0),
  )
  return {
    ...totals,
    downtime,
    maintenance_unknown: unmeasuredMaintenance,
    unknown: Math.max(0, seconds - measured - unmeasuredMaintenance),
    coverage: seconds > 0 ? measured / seconds : 0,
    percent: measured > 0 ? (available / measured) * 100 : null,
  }
}
