import test from 'node:test'
import assert from 'node:assert/strict'
import { createLlmAdapter, validateStructuredOutput } from '../../server/llm.mjs'
import { createAuditLogger, createStructuredLog, redactPii } from '../../server/security.mjs'

const schema = { type: 'object', required: ['intent'], additionalProperties: false, properties: { intent: { type: 'string', enum: ['book', 'unknown'] } } }

test('structured LLM adapter validates output and returns version metadata', async () => {
  const result = await createLlmAdapter({ model: 'model-x', promptVersion: 'prompt-7', schema, provider: async () => ({ intent: 'book' }) }).complete({ text: 'hello' })
  assert.equal(result.status, 'ok')
  assert.deepEqual(result.output, { intent: 'book' })
  assert.equal(result.metadata.model, 'model-x')
  assert.equal(result.metadata.promptVersion, 'prompt-7')
})

test('provider, timeout, and schema failures fall back to needs_human', async () => {
  const timeout = createLlmAdapter({ schema, timeoutMs: 1, provider: () => new Promise(() => {}) })
  assert.equal((await timeout.complete({})).status, 'needs_human')
  const invalid = createLlmAdapter({ schema, provider: async () => ({ intent: 'not-valid' }) })
  assert.equal((await invalid.complete({})).status, 'needs_human')
  const thrown = createLlmAdapter({ schema, provider: async () => { throw new Error('down') } })
  assert.equal((await thrown.complete({})).reason, 'llm_unavailable')
})

test('PII is redacted without mutating the input', () => {
  const input = { email: 'ada@example.com', note: 'Call +65 9123 4567 or ada@example.com', nested: { token: 'secret' } }
  const safe = redactPii(input)
  assert.equal(input.email, 'ada@example.com')
  assert.equal(safe.email, '[REDACTED]')
  assert.equal(safe.nested.token, '[REDACTED]')
  assert.match(safe.note, /REDACTED_(PHONE|EMAIL)/)
})

test('audit and log helpers emit structured redacted records', () => {
  const auditRecords = []
  const logRecords = []
  const audit = createAuditLogger({ sink: (record) => auditRecords.push(record), clock: () => new Date('2026-01-01T00:00:00.000Z') })
  const log = createStructuredLog({ sink: (record) => logRecords.push(record) })
  assert.equal(audit('test.event', { email: 'a@example.com' }).event, 'test.event')
  log.info('test.log', { phone: '+1 555 555 5555' })
  assert.equal(auditRecords[0].email, '[REDACTED]')
  assert.equal(logRecords[0].phone, '[REDACTED]')
})

test('schema validator reports invalid output', () => {
  assert.deepEqual(validateStructuredOutput({ intent: 4 }, schema).valid, false)
})
