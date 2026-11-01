import { createServer } from 'node:http'
import type { FastifyInstance } from 'fastify'
import { collectDefaultMetrics, Histogram, Registry } from 'prom-client'
export function instrumentApi(app: FastifyInstance) {
  const registry = new Registry()
  const requests = new Histogram({
    name: 'quotedb_api_request_duration_seconds',
    help: 'API response duration',
    labelNames: ['route', 'method', 'status'] as const,
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
    registers: [registry],
  })
  const knownRoutes = new Set<string>()
  app.addHook('onRoute', (route) => {
    knownRoutes.add(route.url)
  })
  app.addHook('onResponse', async (request, reply) => {
    const route = request.routeOptions.url
    requests.observe(
      {
        route: route && knownRoutes.has(route) ? route : 'unmatched',
        method: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'HEAD', 'OPTIONS'].includes(
          request.method,
        )
          ? request.method
          : 'OTHER',
        status: `${Math.floor(reply.statusCode / 100)}xx`,
      },
      reply.elapsedTime / 1000,
    )
  })
  return registry
}
export function startMetrics(registry: Registry) {
  collectDefaultMetrics({ register: registry, prefix: 'quotedb_api_' })
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

declare module 'fastify' {
  interface FastifyInstance {
    metrics: Registry
  }
}
