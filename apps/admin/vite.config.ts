import { sign } from 'node:crypto'
import { readFileSync } from 'node:fs'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '../..', '')
  return {
    envDir: '../..',
    plugins: [react(), tailwindcss()],
    server: {
      port: 5181,
      strictPort: true,
      // Same-origin in dev: the browser talks to Vite, Vite forwards /api to the API.
      proxy: {
        '/api': {
          target: env.API_PROXY_TARGET ?? 'http://localhost:3000',
          configure(proxy) {
            if (mode !== 'development' || !env.ADMIN_DEV_PRIVATE_KEY_FILE || !env.ADMIN_DEV_EMAIL)
              return
            const key = readFileSync(env.ADMIN_DEV_PRIVATE_KEY_FILE, 'utf8')
            proxy.on('proxyReq', (req) => {
              const now = Math.floor(Date.now() / 1000)
              const encode = (value: unknown) =>
                Buffer.from(JSON.stringify(value)).toString('base64url')
              const data = `${encode({ alg: 'RS256' })}.${encode({ iss: 'http://quotedb.local/access', aud: env.CF_ACCESS_AUD, sub: env.ADMIN_DEV_EMAIL, email: env.ADMIN_DEV_EMAIL, iat: now, exp: now + 300 })}`
              req.setHeader(
                'cf-access-jwt-assertion',
                `${data}.${sign('RSA-SHA256', Buffer.from(data), key).toString('base64url')}`,
              )
            })
          },
        },
      },
    },
    preview: { port: 5181, strictPort: true },
    build: { chunkSizeWarningLimit: 1000 },
  }
})
