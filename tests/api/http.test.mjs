import test from 'node:test'
import assert from 'node:assert/strict'
import { createHttpHandler } from '../../server/http.mjs'

test('HTTP handler exposes health and rejects malformed webhook JSON', async () => {
  const handler = createHttpHandler({ service: { ingestWebhook: async () => ({ accepted: true }) }, health: async () => ({ status: 'ok' }) })
  const health = await handler(new Request('https://example.test/health'))
  assert.equal(health.status, 200)
  assert.deepEqual(await health.json(), { status: 'ok' })
  const malformed = await handler(new Request('https://example.test/webhooks/whatsapp', { method: 'POST', body: '{' }))
  assert.equal(malformed.status, 400)
})

test('HTTP handler rejects unknown routes and enforces the webhook body limit at the adapter boundary', async () => {
  const handler = createHttpHandler({ service: { ingestWebhook: async () => ({ accepted: true }) } })
  const response = await handler(new Request('https://example.test/unknown'))
  assert.equal(response.status, 404)
})

test('HTTP handler exposes authenticated simulator route delegation and rejects malformed simulator input', async () => {
  const calls = []
  const handler = createHttpHandler({
    service: {
      ingestWebhook: async () => ({ accepted: true }),
      startSimulation: async (input) => { calls.push(['start', input]); if (!input.scenario) throw Object.assign(new Error('Scenario is required.'), { status: 400, code: 'BAD_REQUEST' }); return { simulation: { id: 'sim-1' } } },
      nextSimulation: async (input) => { calls.push(['next', input]); return { status: 'running', turn: 1 } },
    },
  })
  const start = await handler(new Request('https://example.test/api/demo/simulations?workspace_id=ws-1', { method: 'POST', headers: { authorization: 'Bearer token' }, body: JSON.stringify({ scenario: { id: 'delivery', customer: { phone: '+1' } } }) }))
  assert.equal(start.status, 200)
  assert.deepEqual(calls[0][1].workspaceId, 'ws-1')
  assert.equal(calls[0][1].request.headers.get('authorization'), 'Bearer token')
  const next = await handler(new Request('https://example.test/api/demo/simulations/sim-1/next?workspace_id=ws-1', { method: 'POST', headers: { authorization: 'Bearer token' }, body: JSON.stringify({ lastOpsReply: 'Thanks' }) }))
  assert.equal(next.status, 200)
  assert.equal(calls[1][1].simulationId, 'sim-1')
  assert.equal(calls[1][1].lastOpsReply, 'Thanks')
  const malformed = await handler(new Request('https://example.test/api/demo/simulations?workspace_id=ws-1', { method: 'POST', body: '{' }))
  assert.equal(malformed.status, 400)

  const nullBody = await handler(new Request('https://example.test/api/demo/simulations?workspace_id=ws-1', { method: 'POST', body: 'null' }))
  assert.equal(nullBody.status, 400)
  assert.equal(calls[2][0], 'start')
  assert.equal(calls[2][1].scenario, undefined)
})
