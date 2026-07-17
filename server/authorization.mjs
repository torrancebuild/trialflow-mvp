import { forbidden, badRequest } from './errors.mjs'

export async function authorizeWorkspace({ principal, workspaceId, membershipStore, roles = [] }) {
  if (!principal?.id) throw forbidden()
  if (!workspaceId || typeof workspaceId !== 'string') throw badRequest('workspaceId is required.')
  if (!membershipStore || typeof membershipStore.getMembership !== 'function') {
    throw new Error('A membershipStore with getMembership is required.')
  }
  const membership = await membershipStore.getMembership({ workspaceId, userId: principal.id })
  if (!membership || (roles.length && !roles.includes(membership.role))) throw forbidden()
  return { ...principal, workspaceId, role: membership.role, membership }
}
