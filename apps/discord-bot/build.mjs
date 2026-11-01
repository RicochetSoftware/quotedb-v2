import { readFileSync } from 'node:fs'
import { build } from 'esbuild'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))
await build({
  entryPoints: ['src/index.ts', 'src/migrate.ts', 'src/rotate-key.ts', 'src/commands/register.ts'],
  outdir: 'dist',
  bundle: true,
  external: Object.keys(pkg.dependencies).filter((name) => !name.startsWith('@quotedb/')),
  platform: 'node',
  target: 'node24',
  format: 'esm',
  sourcemap: true,
  logLevel: 'info',
})
