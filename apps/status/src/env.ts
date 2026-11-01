export interface Env {
  DISTRIBUTED_PROBES?: string
  PROBE_PAIR?: string
  DB: D1Database
  ASSETS: Fetcher
  MONITOR: Fetcher
  WEB_URL: string
  SITE_URL: string
  API_URL: string
  ADMIN_URL: string
  HTTP_LATENCY_MS: string
  BOT_LATENCY_MS: string
  BOT_SECRET?: string
  BOT_SECRET_PREVIOUS?: string
  OPERATOR_SECRET?: string
  ACCESS_CLIENT_ID?: string
  ACCESS_CLIENT_SECRET?: string
  ADMIN_MONITOR_SECRET?: string
  OTLP_URL?: string
  OTLP_AUTH?: string
  ALERT_URL?: string
  ALERT_AUTH?: string
}
