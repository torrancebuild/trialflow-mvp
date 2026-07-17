import test from 'node:test'
import assert from 'node:assert/strict'
import { createRuntime } from '../../server/runtime.mjs'

test('runtime composes inbound processing and outbound provider workers', async () => {
  const calls = []
  const repo = (job) => ({
    claim: async () => [job],
    markSent: async (input) => calls.push(['sent', input]),
    markRetry: async () => {},
    markFailed: async () => {},
  })
  const runtime = createRuntime({
    workflowOutbox: repo({ id: 'w1', kind: 'process.inbound_message', workspace_id: 'ws', attempts: 1, payload: { event: { id: 'e1' } } }),
    outboundOutbox: repo({ id: 'o1', workspace_id: 'ws', attempts: 1, recipient: '+1', body: 'Hi' }),
    processor: { process: async ({ event }) => { calls.push(['process', event.id]) } },
    whatsappClient: { sendText: async () => ({ providerMessageId: 'wamid.1' }) },
  })
  const result = await runtime.runOnce()
  assert.equal(result.workflow[0].status, 'sent')
  assert.equal(result.outbound[0].status, 'sent')
  assert.deepEqual(calls[0], ['process', 'e1'])
})

test('runtime never sends simulator outbox jobs through WhatsApp', async () => {
  let whatsappCalls = 0
  const repo = {
    claim: async () => [{ id: 'o1', provider: 'simulator', workspace_id: 'ws', attempts: 1, recipient: '+1', body: 'Hi' }],
    markSent: async () => undefined,
    markRetry: async () => undefined,
    markFailed: async () => undefined,
  }
  const runtime = createRuntime({ workflowOutbox: { claim: async () => [], markSent: async () => {}, markRetry: async () => {}, markFailed: async () => {} }, outboundOutbox: repo, processor: { process: async () => {} }, whatsappClient: { sendText: async () => { whatsappCalls += 1 } } })
  const result = await runtime.runOnce({ workspaceId: 'ws' })
  assert.equal(result.outbound[0].skipped, true)
  assert.equal(whatsappCalls, 0)
})
