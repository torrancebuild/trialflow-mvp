import test from 'node:test'
import assert from 'node:assert/strict'
import { authenticate, bearerToken, createSupabaseAuthProvider } from '../../server/auth.mjs'
import { authorizeWorkspace } from '../../server/authorization.mjs'
import { normalizeWebhookEvent, verifyWhatsAppSignature } from '../../server/webhooks.mjs'
import { createHmac } from 'node:crypto'
import { createApiService } from '../../server/service.mjs'

const webhook = { entry: [{ changes: [{ value: { contacts: [{ wa_id: '1555', profile: { name: 'Ada' } }], messages: [{ id: 'wamid.1', from: '1555', timestamp: '1700000000', text: { body: 'Hi there' } }] } }]}] }

test('Supabase auth adapter verifies bearer tokens without an SDK', async () => {
  let call
  const provider = createSupabaseAuthProvider({ url: 'https://example.supabase.co/', publishableKey: 'public', fetchImpl: async (...args) => { call = args; return { ok: true, json: async () => ({ id: 'u1', email: 'a@example.com' }) } } })
  assert.deepEqual(await authenticate({ headers: { Authorization: 'Bearer token' } }, provider), { id: 'u1', email: 'a@example.com', metadata: {} })
  assert.equal(call[0], 'https://example.supabase.co/auth/v1/user')
  assert.equal(call[1].headers.authorization, 'Bearer token')
  assert.equal(bearerToken({ headers: { authorization: 'Basic nope' } }), undefined)
})

test('workspace authorization requires membership and role', async () => {
  const store = { getMembership: async ({ userId }) => userId === 'u1' ? { role: 'operator' } : null }
  assert.equal((await authorizeWorkspace({ principal: { id: 'u1' }, workspaceId: 'w1', membershipStore: store, roles: ['operator'] })).role, 'operator')
  await assert.rejects(() => authorizeWorkspace({ principal: { id: 'u1' }, workspaceId: 'w1', membershipStore: store, roles: ['manager'] }), { status: 403 })
})

test('normalizes supported WhatsApp inbound messages', () => {
  const event = normalizeWebhookEvent(webhook)
  assert.deepEqual(event, { id: 'wamid.1', provider: 'whatsapp', type: 'message.received', occurredAt: '2023-11-14T22:13:20.000Z', externalConversationId: '1555', externalMessageId: 'wamid.1', sender: { id: '1555', name: 'Ada' }, text: 'Hi there', raw: webhook })
})

test('verifies WhatsApp signatures and rejects tampering', () => {
  const rawBody = JSON.stringify(webhook)
  const secret = 'app-secret'
  const signature = `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`
  assert.equal(verifyWhatsAppSignature(rawBody, signature, secret), true)
  assert.equal(verifyWhatsAppSignature(`${rawBody}x`, signature, secret), false)
})

test('ingestion authorizes, persists before enqueue, and is idempotent', async () => {
  const calls = []
  const service = createApiService({ authProvider: { verifyAccessToken: async () => ({ id: 'u1' }) }, membershipStore: { getMembership: async () => ({ role: 'operator' }) }, persistence: { recordInboundEvent: async (input) => { calls.push('persist'); return { duplicate: input.event.id === 'duplicate' } } }, outbox: { enqueue: async (input) => { calls.push('enqueue'); return { id: 'job-1', input } } }, processor: { process: async (input) => input } })
  const rawBody = JSON.stringify(webhook)
  const signature = `sha256=${createHmac('sha256', 'secret').update(rawBody).digest('hex')}`
  const request = { rawBody, headers: { authorization: 'Bearer x', 'x-hub-signature-256': signature } }
  const serviceWithSignature = createApiService({ authProvider: { verifyAccessToken: async () => ({ id: 'u1' }) }, membershipStore: { getMembership: async () => ({ role: 'operator' }) }, persistence: { recordInboundEvent: async (input) => { calls.push('persist'); return { duplicate: input.event.id === 'duplicate' } } }, outbox: { enqueue: async (input) => { calls.push('enqueue'); return { id: 'job-1', input } } }, processor: { process: async (input) => input }, whatsappAppSecret: 'secret' })
  assert.equal((await serviceWithSignature.ingestWebhook({ request, workspaceId: 'w1', payload: webhook })).outboxId, 'job-1')
  assert.deepEqual(calls, ['persist', 'enqueue'])
  const duplicate = { ...webhook, entry: [{ changes: [{ value: { ...webhook.entry[0].changes[0].value, messages: [{ ...webhook.entry[0].changes[0].value.messages[0], id: 'duplicate' }] } }]}] }
  const duplicateBody = JSON.stringify(duplicate)
  const duplicateRequest = { rawBody: duplicateBody, headers: { authorization: 'Bearer x', 'x-hub-signature-256': `sha256=${createHmac('sha256', 'secret').update(duplicateBody).digest('hex')}` } }
  assert.equal((await serviceWithSignature.ingestWebhook({ request: duplicateRequest, workspaceId: 'w1', payload: duplicate })).duplicate, true)
  assert.deepEqual(calls, ['persist', 'enqueue', 'persist'])
})

test('provider-signed webhook can resolve workspace without a user bearer token', async () => {
  const rawBody = JSON.stringify(webhook)
  const signature = `sha256=${createHmac('sha256', 'secret').update(rawBody).digest('hex')}`
  const calls = []
  const service = createApiService({
    whatsappAppSecret: 'secret',
    resolveWebhookWorkspace: async () => 'w1',
    membershipStore: { getMembership: async () => ({ role: 'operator' }) },
    persistence: { recordInboundEvent: async () => { calls.push('persist'); return { duplicate: false } } },
    outbox: { enqueue: async () => { calls.push('enqueue'); return { id: 'job-1' } } },
    processor: { process: async () => undefined },
  })
  const result = await service.ingestWebhook({ request: { rawBody, headers: { 'x-hub-signature-256': signature } }, payload: webhook })
  assert.equal(result.accepted, true)
  assert.deepEqual(calls, ['persist', 'enqueue'])
})
