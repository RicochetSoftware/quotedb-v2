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
      proxy: { '/api': { target: env.API_PROXY_TARGET ?? 'http://localhost:3000' } },
    },
    preview: { port: 5181, strictPort: true },
    build: { chunkSizeWarningLimit: 1000 },
  }
})
