import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDb } from '../src/db/client'
import { loadEnv } from '../src/env'
import { createMemoryMailer } from '../src/lib/mailer'
import { type App, buildApp } from '../src/server'

// Preflights must finish without authentication or a database connection.
const database = createDb('postgres://unused:unused@127.0.0.1:1/unused')
let app: App
const origins = ['https://app.example.com', 'https://admin.example.com']

beforeAll(async () => {
  app = await buildApp({
    env: loadEnv({
      DATABASE_URL: 'postgres://unused:unused@127.0.0.1:1/unused',
      COOKIE_SECRET: 'x'.repeat(32),
      WEB_URL: origins[0],
      ADMIN_URL: origins[1],
    }),
    db: database.db,
    mailer: createMemoryMailer(),
    logger: false,
  })
})

afterAll(async () => {
  await app.close()
  await database.close()
})

describe('browser CORS preflights', () => {
  for (const origin of origins) {
    for (const method of ['DELETE', 'PATCH']) {
      it(`allows ${method} from ${origin}`, async () => {
        const res = await app.inject({
          method: 'OPTIONS',
          url: '/api/v1/admin/users/00000000-0000-0000-0000-000000000000',
          headers: {
            origin,
            'access-control-request-method': method,
            'access-control-request-headers': 'content-type',
          },
        })
        expect(res.statusCode).toBe(204)
        expect(res.headers['access-control-allow-origin']).toBe(origin)
        expect(res.headers['access-control-allow-credentials']).toBe('true')
        expect(String(res.headers['access-control-allow-methods']).split(/,\s*/)).toContain(method)
        expect(res.headers['access-control-allow-headers']).toBe('content-type')
      })
    }
  }

  it('does not grant access to an untrusted origin', async () => {
    const res = await app.inject({
      method: 'OPTIONS',
      url: '/api/v1/admin/users/00000000-0000-0000-0000-000000000000',
      headers: {
        origin: 'https://untrusted.example.com',
        'access-control-request-method': 'DELETE',
      },
    })
    expect(res.headers['access-control-allow-origin']).toBeUndefined()
  })
})
