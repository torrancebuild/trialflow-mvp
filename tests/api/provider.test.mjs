import test from 'node:test'
import assert from 'node:assert/strict'
import { createWhatsAppClient, normalizeDeliveryStatus, createDeliveryReconciler } from '../../server/whatsapp.mjs'
import { createOutboxWorker, retryDelay } from '../../server/outbox.mjs'

test('WhatsApp client sends text through the Cloud API', async () => {
  let request
  const client = createWhatsAppClient({ accessToken: 'token', phoneNumberId: '123', fetchImpl: async (...args) => { request = args; return { ok: true, status: 200, json: async () => ({ messages: [{ id: 'wamid.1' }] }) } } })
  assert.deepEqual(await client.sendText('+1 (555) 12', 'Hello', { idempotencyKey: 'w1:k1' }), { provider: 'whatsapp', providerMessageId: 'wamid.1', messages: [{ id: 'wamid.1' }] })
  assert.equal(request[0], 'https://graph.facebook.com/v20.0/123/messages')
  assert.equal(request[1].headers.authorization, 'Bearer token')
  assert.equal(request[1].headers['x-idempotency-key'], 'w1:k1')
  assert.deepEqual(JSON.parse(request[1].body).text, { preview_url: false, body: 'Hello' })
})

test('delivery statuses normalize and reconcile idempotently', async () => {
  const calls = []
  const reconciler = createDeliveryReconciler({ repository: { recordProviderEvent: async (x) => { calls.push(x); return { duplicate: calls.length > 1 } }, updateDeliveryStatus: async (x) => { calls.push(x); return x } } })
  const payload = { statuses: [{ id: 'wamid.1', status: 'delivered', timestamp: '1700000000', recipient_id: '1555' }] }
  const first = await reconciler.reconcile(payload)
  assert.equal(first.event.type, 'message.delivered')
  assert.equal(first.duplicate, false)
  assert.equal((await reconciler.reconcile(payload)).duplicate, true)
  assert.equal(calls.length, 3)
  assert.equal(normalizeDeliveryStatus(payload).occurredAt, '2023-11-14T22:13:20.000Z')
})

test('outbox worker leases jobs and retries transient failures with backoff', async () => {
  let now = 1700000000000
  const calls = []
  const repository = { claim: async () => [{ id: 'job-1', kind: 'send', payload: {}, attempts: 0, leaseToken: 'lease-1' }], markSent: async (x) => calls.push(['sent', x]), markRetry: async (x) => calls.push(['retry', x]), markFailed: async (x) => calls.push(['failed', x]) }
  const worker = createOutboxWorker({ repository, clock: () => now, handlers: { send: async () => { const error = new Error('rate limited'); error.status = 429; throw error } }, retry: { baseDelayMs: 10 } })
  assert.deepEqual(await worker.runOnce(), [{ id: 'job-1', status: 'retry', attempts: 1, delayMs: 10 }])
  assert.equal(calls[0][0], 'retry')
  assert.equal(calls[0][1].leaseToken, 'lease-1')
  assert.equal(calls[0][1].nextAttemptAt.getTime(), now + retryDelay(1, { baseDelayMs: 10 }))
})
