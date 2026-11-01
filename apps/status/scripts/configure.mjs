import { readFile, writeFile } from 'node:fs/promises'

const id = process.env.STATUS_DATABASE_ID
if (!id || !/^[a-f\d-]{36}$/.test(id)) throw new Error('Set STATUS_DATABASE_ID from tofu output')
for (const name of ['public', 'monitor', 'maintenance', 'frontend', 'backend', 'exporter']) {
  const config = JSON.parse(await readFile(`wrangler.${name}.jsonc`, 'utf8'))
  config.d1_databases[0].database_id = id
  if (process.env.ADMIN_HOST && ['monitor', 'backend'].includes(name))
    config.vars.ADMIN_URL = `https://${process.env.ADMIN_HOST}/_monitor/health`
  await writeFile(`wrangler.${name}.generated.json`, JSON.stringify(config, null, 2))
}
