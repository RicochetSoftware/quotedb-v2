import { createRemoteJWKSet, importSPKI, jwtVerify } from 'jose'
import type { Env } from '../env'

/** A local public key allows real signed-token verification in dev/test, never a bypass. */
export async function createAccessVerifier(env: Env) {
  const local = env.NODE_ENV !== 'production' && env.ADMIN_DEV_PUBLIC_KEY
  const issuer = local
    ? 'http://quotedb.local/access'
    : `https://${env.CF_ACCESS_TEAM}.cloudflareaccess.com`
  const keys = local
    ? await importSPKI(local.replaceAll('\\n', '\n'), 'RS256')
    : env.CF_ACCESS_TEAM
      ? createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`))
      : null
  return async (token: string) => {
    if (!keys || !env.CF_ACCESS_AUD) throw new Error('Admin authentication is not configured')
    const { payload } = await jwtVerify(token, await keys, {
      issuer,
      audience: env.CF_ACCESS_AUD,
      algorithms: ['RS256'],
      requiredClaims: ['exp', 'iat', 'sub', 'email'],
    })
    if (typeof payload.email !== 'string' || !payload.email.includes('@'))
      throw new Error('Missing email')
    return payload.email.trim().toLowerCase()
  }
}
