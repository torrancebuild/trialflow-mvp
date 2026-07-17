import test from 'node:test'
import assert from 'node:assert/strict'
import { createApiService } from '../../server/service.mjs'

function serviceFor(role = 'manager') {
  const calls = []
  const persistence = {
    recordInboundEvent: async () => undefined,
    getTask: async () => ({ id: 't1', version: 4, draft_status: 'approved', draft_reply: 'Confirmed', conversation_id: 'c1' }),
    getConversation: async () => ({ id: 'c1', customer_phone: '+6512345678' }),
    confirmTask: async (input) => { calls.push(['confirm', input]); return { task_version: 5, reservation_id: 'r1' } },
    patchTaskVersion: async (input) => { calls.push(['patch', input]); return { id: 't1', version: 5 } },
  }
  const outbox = { enqueue: async () => undefined, outbound: { enqueue: async (input) => { calls.push(['outbound', input]); return { id: 'o1' } } } }
  const service = createApiService({
    authProvider: { verifyAccessToken: async () => ({ id: 'u1' }) },
    membershipStore: { getMembership: async () => ({ role }) },
    persistence,
    outbox,
    processor: { process: async () => undefined },
    whatsappAppSecret: 'secret',
  })
  return { service, calls }
}

const request = { headers: { authorization: 'Bearer token' } }

test('confirm action reserves before transitioning and requires manager role', async () => {
  const { service, calls } = serviceFor('manager')
  await service.executeTaskAction({ request, workspaceId: 'w1', taskId: 't1', action: 'confirm', payload: { slotId: 's1', reservationKey: 'k1', eventId: 'e1', expectedVersion: 4 } })
  assert.equal(calls[0][0], 'confirm')
  assert.equal(calls[0][1].expectedVersion, 4)

  const operator = serviceFor('operator').service
  await assert.rejects(() => operator.executeTaskAction({ request, workspaceId: 'w1', taskId: 't1', action: 'confirm', payload: { slotId: 's1', reservationKey: 'k1' } }), { status: 403 })
})

test('send action queues the persisted draft idempotently', async () => {
  const { service, calls } = serviceFor()
  await service.executeTaskAction({ request, workspaceId: 'w1', taskId: 't1', action: 'send', payload: { expectedVersion: 4, idempotencyKey: 'reply-key' } })
  assert.equal(calls[0][0], 'outbound')
  assert.equal(calls[0][1].idempotencyKey, 'reply-key')
  assert.equal(calls[0][1].recipient, '+6512345678')
  assert.equal(calls[0][1].provider, 'whatsapp')
})

test('generic transition path cannot confirm a booking', async () => {
  const { service } = serviceFor('manager')
  await assert.rejects(() => service.transitionTask({ request, workspaceId: 'w1', taskId: 't1', expectedVersion: 4, nextState: 'confirmed', eventId: 'e2' }), { status: 403 })
})
