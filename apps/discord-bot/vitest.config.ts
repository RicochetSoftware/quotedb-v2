import { defineConfig } from 'vitest/config'
export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/commands/register.ts', 'src/index.ts', 'src/migrate.ts'],
    },
    hookTimeout: 120_000,
  },
})
