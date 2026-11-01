/**
 * Feature scopes an API token can hold (MIGRATION.md §3.6). Keep this list small:
 * every scope is a choice the user makes at token-creation time and a row in the test matrix.
 */
export const SCOPES = ['quotes:read', 'quotes:write', 'profile:read'] as const

export type Scope = (typeof SCOPES)[number]

export const SCOPE_DESCRIPTIONS: Record<Scope, string> = {
  'quotes:read': 'List, get, search and pick random quotes (own quotes only)',
  'quotes:write': 'Create, update and delete quotes (own quotes only)',
  'profile:read': 'Read your profile via GET /me',
}

export const DEFAULT_TOKEN_SCOPES: Scope[] = ['quotes:read']

export function isScope(value: string): value is Scope {
  return (SCOPES as readonly string[]).includes(value)
}
