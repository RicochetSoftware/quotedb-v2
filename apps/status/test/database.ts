import { readdirSync, readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
export function database() {
  const sqlite = new DatabaseSync(':memory:')
  for (const file of readdirSync(new URL('../migrations/', import.meta.url)).sort())
    sqlite.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8'))
  class Statement {
    values: unknown[] = []
    constructor(readonly sql: string) {}
    bind(...values: unknown[]) {
      this.values = values
      return this
    }
    async all() {
      return { results: sqlite.prepare(this.sql).all(...(this.values as never[])), success: true }
    }
    async first() {
      return sqlite.prepare(this.sql).get(...(this.values as never[])) ?? null
    }
    async run() {
      const result = sqlite.prepare(this.sql).run(...(this.values as never[]))
      return { success: true, results: [], meta: { changes: Number(result.changes) } }
    }
  }
  const db = {
    prepare: (sql: string) => new Statement(sql),
    async batch(statements: Statement[]) {
      sqlite.exec('BEGIN')
      try {
        const results = []
        for (const statement of statements)
          results.push(
            /^(SELECT|WITH)/i.test(statement.sql) ? await statement.all() : await statement.run(),
          )
        sqlite.exec('COMMIT')
        return results
      } catch (error) {
        sqlite.exec('ROLLBACK')
        throw error
      }
    },
  }
  return db as unknown as D1Database
}
