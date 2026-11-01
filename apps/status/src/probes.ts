import type { Env } from './env'
import type { Component, Observation } from './model'

export async function boundedText(
  response: Response,
  limit = 262144,
  prefix = false,
): Promise<string> {
  if (!response.body) throw new Error('content')
  const reader = response.body.getReader()
  let size = 0
  const chunks: Uint8Array[] = []
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (prefix && size + value.byteLength >= limit) {
        chunks.push(value.subarray(0, limit - size))
        size = limit
        break
      }
      size += value.byteLength
      if (size > limit) throw new Error('body_size')
      chunks.push(value)
    }
  } finally {
    await reader.cancel()
  }
  const joined = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    joined.set(chunk, offset)
    offset += chunk.length
  }
  return new TextDecoder().decode(joined)
}
async function get(
  url: string,
  signal: AbortSignal,
  headers?: Record<string, string>,
  prefix = false,
) {
  const response = await fetch(url, {
    signal,
    redirect: 'manual',
    headers: {
      'Cache-Control': 'no-cache',
      ...(prefix ? { Range: 'bytes=0-511', 'Accept-Encoding': 'identity' } : {}),
      ...headers,
    },
    cache: 'no-store',
  })
  if (response.status !== 200 && !(prefix && response.status === 206)) {
    await response.body?.cancel()
    throw new Error('http_status')
  }
  return boundedText(response, prefix ? 512 : 262144, prefix)
}
async function shell(url: string, signal: AbortSignal) {
  const html = await get(url, signal)
  if (!html.toLowerCase().includes('quotedb')) throw new Error('content')
  const path =
    html.match(/(?:src|href)=["']([^"']*\/(?:assets|_astro)\/[^"']+\.css)["']/)?.[1] ??
    html.match(/(?:src|href)=["']([^"']*\/(?:assets|_astro)\/[^"']+\.js)["']/)?.[1]
  if (!path) throw new Error('asset_missing')
  const asset = new URL(path, url)
  if (asset.origin !== new URL(url).origin) throw new Error('asset_origin')
  const content = await get(asset.toString(), signal, undefined, true)
  if (!content.trim() || /^\s*<!doctype/i.test(content)) throw new Error('asset_content')
}
export async function probe(
  component: Exclude<Component, 'bot'>,
  env: Env,
  at: number,
): Promise<Observation> {
  const start = Date.now()
  const signal = AbortSignal.timeout(5000)
  try {
    if (component === 'web' || component === 'site')
      await shell(component === 'web' ? env.WEB_URL : env.SITE_URL, signal)
    else if (component === 'admin') {
      if (!env.ACCESS_CLIENT_ID || !env.ACCESS_CLIENT_SECRET || !env.ADMIN_MONITOR_SECRET)
        throw new Error('configuration')
      const body = JSON.parse(
        await get(env.ADMIN_URL, signal, {
          'CF-Access-Client-Id': env.ACCESS_CLIENT_ID,
          'CF-Access-Client-Secret': env.ACCESS_CLIENT_SECRET,
          'X-Monitor-Secret': env.ADMIN_MONITOR_SECRET,
        }),
      )
      if (body.ok !== true || body.asset !== true) throw new Error('content')
    } else {
      const ready = JSON.parse(await get(`${env.API_URL}/healthz`, signal))
      if (ready.ok !== true) throw new Error('content')
      // Existing unauthenticated route; validate shape and discard content immediately.
      const featured = JSON.parse(await get(`${env.API_URL}/api/v1/public/izaro`, signal))
      if (
        !['quote', 'author', 'date', 'added_by'].every((key) => typeof featured[key] === 'string')
      )
        throw new Error('content')
    }
    const duration = Date.now() - start
    return {
      component,
      at,
      duration,
      outcome: duration > Number(env.HTTP_LATENCY_MS || 1500) ? 'slow' : 'healthy',
      reason: null,
    }
  } catch (error) {
    const allowed = [
      'http_status',
      'content',
      'body_size',
      'asset_missing',
      'asset_origin',
      'asset_content',
      'configuration',
    ]
    const reason = signal.aborted
      ? 'timeout'
      : error instanceof Error && allowed.includes(error.message)
        ? error.message
        : 'network'
    return { component, at, duration: Date.now() - start, outcome: 'failed', reason }
  }
}
