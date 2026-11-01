// Opt-in local signer. Only the development Vite proxy reads the private key.
import { generateKeyPairSync } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const directory = resolve('.local')
mkdirSync(directory, { recursive: true, mode: 0o700 })
const privateFile = resolve(directory, 'admin-private.pem')
const publicFile = resolve(directory, 'admin-public.pem')
if (!existsSync(privateFile)) {
  const keys = generateKeyPairSync('rsa', { modulusLength: 2048 })
  writeFileSync(privateFile, keys.privateKey.export({ type: 'pkcs8', format: 'pem' }), {
    mode: 0o600,
  })
  writeFileSync(publicFile, keys.publicKey.export({ type: 'spki', format: 'pem' }), { mode: 0o600 })
}
let env = existsSync('.env') ? readFileSync('.env', 'utf8') : readFileSync('.env.example', 'utf8')
for (const [key, value] of Object.entries({
  CF_ACCESS_AUD: 'quotedb-local-admin',
  ADMIN_DEV_PUBLIC_KEY: readFileSync(publicFile, 'utf8').trim().replaceAll('\n', '\\n'),
  ADMIN_DEV_PRIVATE_KEY_FILE: privateFile,
  ADMIN_DEV_EMAIL: 'admin@quotedb.local',
})) {
  env = env.replace(new RegExp(`^${key}=.*\\n?`, 'gm'), '')
  env += `\n${key}=${value}\n`
}
writeFileSync('.env', env, { mode: 0o600 })
console.log(
  'Local admin signer configured. Restart pnpm dev; admin@quotedb.local must exist with an admin role. Never use these keys in production.',
)
