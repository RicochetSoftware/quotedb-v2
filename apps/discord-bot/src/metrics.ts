import { createServer } from 'node:http'
import { Counter, collectDefaultMetrics, Gauge, Histogram, Registry } from 'prom-client'
export const registry = new Registry()
export const readiness = new Gauge({
  name: 'quotedb_bot_ready',
  help: 'Bot dependency readiness',
  registers: [registry],
})
export const gateway = new Gauge({
  name: 'quotedb_bot_gateway_latency_seconds',
  help: 'Discord gateway latency',
  registers: [registry],
})
export const reconnects = new Counter({
  name: 'quotedb_bot_reconnects_total',
  help: 'Discord reconnects',
  registers: [registry],
})
export const commands = new Histogram({
  name: 'quotedb_bot_command_duration_seconds',
  help: 'Interaction execution duration',
  labelNames: ['kind', 'outcome'] as const,
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30],
  registers: [registry],
})
export function startMetrics() {
  collectDefaultMetrics({ register: registry, prefix: 'quotedb_bot_' })
  const server = createServer(async (req, res) => {
    if (req.url !== '/metrics') {
      res.writeHead(404).end()
      return
    }
    try {
      res.setHeader('content-type', registry.contentType)
      res.end(await registry.metrics())
    } catch {
      res.writeHead(503).end()
    }
  })
  server.on('error', () => console.warn('metrics_listener_failed'))
  server.listen(9091, '0.0.0.0')
  return server
}
