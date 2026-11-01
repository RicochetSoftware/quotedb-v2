import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import postgres from 'postgres'
import type { TestProject } from 'vitest/node'
import { runMigrations } from '../src/migrate'

declare module 'vitest' {
  export interface ProvidedContext {
    pgAdminUrl: string
    pgTemplate: string
  }
}

const TEMPLATE = 'quotedb_template'

/**
 * One real Postgres 17 for the whole run (no DB mocks). Migrations are applied once to a template
 * database; every test file clones it into its own database, so files run in parallel safely.
 */
export default async function setup(project: TestProject) {
  const container: StartedPostgreSqlContainer = await new PostgreSqlContainer('postgres:17').start()
  const adminUrl = container.getConnectionUri()

  const admin = postgres(adminUrl, { max: 1, onnotice: () => {} })
  await admin.unsafe(`create database ${TEMPLATE}`)
  await admin.end()

  const templateUrl = new URL(adminUrl)
  templateUrl.pathname = `/${TEMPLATE}`
  await runMigrations(templateUrl.toString())

  project.provide('pgAdminUrl', adminUrl)
  project.provide('pgTemplate', TEMPLATE)

  return async () => {
    await container.stop()
  }
}
