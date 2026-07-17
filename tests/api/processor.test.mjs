import test from 'node:test'
import assert from 'node:assert/strict'
import { createInboundProcessor } from '../../server/processor.mjs'

test('inbound processor persists a needs-human task when the LLM fails', async () => {
  const calls = []
  const processor = createInboundProcessor({
    llm: { complete: async () => ({ status: 'needs_human' }) },
    availability: async () => [],
    persistence: {
      ensureConversation: async () => ({ id: 'c1' }),
      createTask: async ({ task }) => { calls.push(['task', task]); return { id: 't1', ...task } },
      appendTaskEvent: async (event) => calls.push(['event', event]),
    },
  })
  const result = await processor.process({ workspaceId: 'w1', event: { id: 'e1', provider: 'whatsapp', externalConversationId: '1555', text: 'Hi' } })
  assert.equal(result.state, 'needs_human')
  assert.equal(calls[0][1].needs_human_reason, 'llm_unavailable')
})

test('processor retries repair the event and audit after a task already exists', async () => {
  const calls = []
  const processor = createInboundProcessor({
    llm: { complete: async () => { throw new Error('should not call LLM') } },
    availability: async () => [],
    persistence: {
      ensureConversation: async () => ({ id: 'c1' }),
      getTaskForConversation: async () => ({ id: 't1', state: 'needs_human' }),
      createTask: async () => ({ id: 'unused' }),
      appendTaskEvent: async (value) => calls.push(['event', value]),
      writeAudit: async (value) => calls.push(['audit', value]),
    },
  })
  const result = await processor.process({ workspaceId: 'w1', event: { id: 'e1', provider: 'whatsapp', externalConversationId: '1555', text: 'Hi' } })
  assert.equal(result.repaired, true)
  assert.deepEqual(calls.map(([type]) => type), ['event', 'audit'])
})
