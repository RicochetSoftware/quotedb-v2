import postgres from 'postgres'
import { migrate } from './db/migrations.js'
import { upgradeConnections } from './db/upgrade-collections.js'
import { required } from './env.js'

// Only this one-shot process gets database-owner credentials.
const sql = postgres(process.env.BOT_MIGRATION_DATABASE_URL ?? required('DATABASE_URL'), {
  max: 1,
  onnotice: () => {},
})
try {
  const runtime = new URL(required('BOT_DATABASE_URL'))
  if (runtime.username !== 'quotedb_bot' || !runtime.password)
    throw new Error('Runtime URL must use quotedb_bot with a password')
  const password = decodeURIComponent(runtime.password)
  const [exists] = await sql`select 1 from pg_roles where rolname='quotedb_bot'`
  if (!exists) await sql`create role quotedb_bot login`
  const [statement] =
    await sql`select format('alter role quotedb_bot password %L', ${password}::text) as text`
  if (!statement) throw new Error('Could not configure database role')
  await sql.unsafe(statement.text)
  await migrate(sql)
  await upgradeConnections(
    sql,
    process.env.BOT_ENCRYPTION_KEY ? Buffer.from(process.env.BOT_ENCRYPTION_KEY, 'hex') : undefined,
  )
  await sql`grant usage on schema discord_bot to quotedb_bot`
  await sql`grant select, insert, update, delete on all tables in schema discord_bot to quotedb_bot`
  console.info('Bot database migrated')
} catch {
  console.error('Bot migration failed. Check database credentials and privileges.')
  process.exitCode = 1
} finally {
  await sql.end()
}
