// Bundles the API into dist/. Workspace packages (@quotedb/*) are inlined because they ship as
// TypeScript source; every other dependency stays external and is installed by `pnpm deploy`.
import { readFileSync } from 'node:fs'
import { build } from 'esbuild'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))
const external = Object.keys(pkg.dependencies ?? {}).filter((d) => !d.startsWith('@quotedb/'))

await build({
  entryPoints: ['src/index.ts', 'src/migrate.ts'],
  outdir: 'dist',
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'esm',
  sourcemap: true,
  external: [...external, ...external.map((d) => `${d}/*`)],
  logLevel: 'info',
})
