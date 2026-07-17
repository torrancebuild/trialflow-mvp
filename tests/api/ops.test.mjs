import test from 'node:test'
import assert from 'node:assert/strict'
import { createMetrics, healthCheck } from '../../server/ops.mjs'

test('metrics snapshot is structured and health reports dependency failure', async () => {
  const metrics = createMetrics()
  metrics.increment('webhook.accepted')
  metrics.increment('webhook.accepted', 2)
  assert.deepEqual(metrics.snapshot(), { 'webhook.accepted': 3 })
  const result = await healthCheck({ db: async () => true, provider: async () => false, version: 'test' })
  assert.equal(result.status, 'degraded')
  assert.equal(result.checks.database, true)
  assert.equal(result.checks.provider, false)
})
