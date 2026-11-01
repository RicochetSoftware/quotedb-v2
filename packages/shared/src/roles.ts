export const ROLES = ['USER', 'ADMIN', 'SUPER_ADMIN'] as const

export type Role = (typeof ROLES)[number]

export function isAdminRole(role: Role): boolean {
  return role === 'ADMIN' || role === 'SUPER_ADMIN'
}
