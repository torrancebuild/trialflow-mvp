/**
 * Runtime-free contracts for adapters. Implementations may be backed by Supabase,
 * Postgres, a queue, or an in-memory test double.
 *
 * membershipStore.getMembership({ workspaceId, userId }) -> { role } | null
 * persistence.recordInboundEvent({ workspaceId, actor, event }) -> { duplicate, message }
 * outbox.enqueue({ workspaceId, kind, payload, idempotencyKey }) -> outbox item
 * processor.process({ workspaceId, event, persistence, outbox }) -> result
 */
export const ROLES = Object.freeze({ MANAGER: 'manager', OPERATOR: 'operator' })
