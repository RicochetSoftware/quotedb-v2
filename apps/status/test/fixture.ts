// Public, content-free nonproduction probe target. No credentials or application data.
export default {
  async fetch(request: Request) {
    const path = new URL(request.url).pathname
    if (path.startsWith('/failed')) return new Response('Unavailable', { status: 503 })
    if (path.startsWith('/timeout')) await new Promise((resolve) => setTimeout(resolve, 6000))
    if (path.startsWith('/slow')) await new Promise((resolve) => setTimeout(resolve, 1600))
    if (path.endsWith('/healthz')) return Response.json({ ok: true })
    if (path.endsWith('/admin')) return Response.json({ ok: true, asset: true })
    if (path.endsWith('/izaro'))
      return Response.json({
        quote: 'fixture',
        author: 'fixture',
        date: '2026-11-02',
        added_by: 'fixture',
      })
    if (path === '/assets/fixture.css') return new Response('body{color:black}')
    return new Response('<title>QuoteDB</title><link href="/assets/fixture.css">', {
      headers: { 'content-type': 'text/html' },
    })
  },
}
