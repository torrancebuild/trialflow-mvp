import test from 'node:test'
import assert from 'node:assert/strict'
import { createSupabaseAdapters, createSupabasePersistence, createSupabaseOutbox } from '../../server/persistence.mjs'

function mockFetch(responses = []) {
  const calls = []
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init })
    const next = responses.shift() ?? {}
    return { ok: next.ok ?? true, status: next.status ?? 200, text: async () => next.body === undefined ? JSON.stringify(next.data ?? []) : next.body }
  }
  return { fetchImpl, calls }
}

test('uses the service key and atomically records inbound events through the RPC', async () => {
  const mock = mockFetch([{ data: [{ duplicate: false, conversation_id: 'c1', message_id: 'm1' }] }, { data: [{ id: 1 }] }])
  const persistence = createSupabasePersistence({ url: 'https://demo.supabase.co', serviceKey: 'server-secret', fetchImpl: mock.fetchImpl })
  const result = await persistence.recordInboundEvent({ workspaceId: 'w1', actor: { id: 'u1' }, event: { id: 'e1', provider: 'whatsapp', externalConversationId: '1555', externalMessageId: 'm1', text: 'Hi', occurredAt: '2026-01-01T00:00:00Z', raw: { source: true } } })
  assert.equal(result.duplicate, false)
  assert.match(mock.calls[0].url, /\/rest\/v1\/rpc\/ingest_inbound_event$/)
  assert.equal(mock.calls[0].init.headers.authorization, 'Bearer server-secret')
  assert.deepEqual(JSON.parse(mock.calls[0].init.body).target_workspace_id, 'w1')
  assert.equal(mock.calls[1].init.headers.authorization, 'Bearer server-secret')
})

test('outbox enqueue is idempotent and claim/update use workflow jobs', async () => {
  const mock = mockFetch([{ data: [] }, { data: [{ id: 'j1', attempts: 0 }] }, { data: [{ id: 'j1', attempts: 1, status: 'processing' }] }, { data: [{ id: 'j1', status: 'completed' }] }])
  const outbox = createSupabaseOutbox({ url: 'https://demo.supabase.co', serviceKey: 'server-secret', fetchImpl: mock.fetchImpl })
  assert.equal((await outbox.enqueue({ workspaceId: 'w1', kind: 'k', payload: { x: 1 }, idempotencyKey: 'w1:k' })).id, 'j1')
  assert.equal((await outbox.claim({ workspaceId: 'w1' }))[0].status, 'processing')
  assert.equal((await outbox.update({ workspaceId: 'w1', id: 'j1', status: 'completed' })).status, 'completed')
  assert.match(mock.calls[0].url, /workflow_jobs\?on_conflict=workspace_id%2Cidempotency_key/)
})

test('task transitions call optimistic concurrency RPC and audit writes', async () => {
  const mock = mockFetch([{ data: [true] }])
  const persistence = createSupabasePersistence({ url: 'https://demo.supabase.co', serviceKey: 'server-secret', fetchImpl: mock.fetchImpl })
  const result = await persistence.transitionTask({ workspaceId: 'w1', taskId: 't1', expectedVersion: 3, nextState: 'confirmed', actor: { id: 'u1' }, eventId: 'evt-1' })
  assert.deepEqual(JSON.parse(mock.calls[0].init.body), { target_task_id: 't1', expected_version: 3, next_state: 'confirmed', p_event_id: 'evt-1', actor_id: 'u1', event_payload: {} })
  assert.deepEqual(result, { updated: true, version: 4 })
  assert.match(mock.calls[0].url, /rpc\/transition_task$/)
})

test('canonical adapter factory wires the outbound delivery repository', () => {
  const adapters = createSupabaseAdapters({ url: 'https://demo.supabase.co', serviceKey: 'server-secret', fetchImpl: async () => ({ ok: true, text: async () => '[]' }) })
  assert.equal(typeof adapters.outboundOutbox.claim, 'function')
  assert.equal(typeof adapters.outboundOutbox.markSent, 'function')
  assert.equal(typeof adapters.outboundOutbox.markSimulatedSent, 'function')
})

test('simulator outbox rows can be finalized without a worker lease', async () => {
  const mock = mockFetch([{ data: [{ id: 'o1', status: 'sent' }] }])
  const adapters = createSupabaseAdapters({ url: 'https://demo.supabase.co', serviceKey: 'server-secret', fetchImpl: mock.fetchImpl })
  const result = await adapters.outboundOutbox.markSimulatedSent({ workspaceId: 'w1', id: 'o1' })
  assert.deepEqual(result, { id: 'o1', status: 'sent' })
  assert.match(mock.calls[0].url, /outbound_outbox\?workspace_id=eq\.w1&id=eq\.o1&provider=eq\.simulator&status=eq\.queued/)
  assert.equal(JSON.parse(mock.calls[0].init.body).status, 'sent')
})
