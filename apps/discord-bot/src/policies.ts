import type { Policy } from './db/store.js'

export function channelAllowed(policy: Policy, channel: string, parent?: string | null) {
  return (
    policy.mode === 'all' ||
    policy.ids.includes(channel) ||
    (!!parent && policy.ids.includes(parent))
  )
}
export function creatorAllowed(policy: Policy, roles: string[], admin: boolean) {
  return admin || policy.mode === 'all' || policy.ids.some((id) => roles.includes(id))
}
export class UserError extends Error {}
