import assert from 'node:assert/strict'
import test from 'node:test'
import { createOpenAiResponsesProvider } from '../../server/openai.mjs'

test('OpenAI Responses provider sends server-side structured output requests', async () => {
  let request
  const provider = createOpenAiResponsesProvider({ apiKey: 'server-only', instructions: 'workflow instructions', fetchImpl: async (url, init) => {
    request = { url, init }
    return { ok: true, status: 200, json: async () => ({ output: [{ type: 'message', content: [{ type: 'output_text', text: '{"text":"Around 6pm","shouldStop":false}' }] }] }) }
  } })
  const output = await provider({ input: 'customer prompt', model: 'gpt-test', schema: { type: 'object' } })
  assert.deepEqual(output, { text: 'Around 6pm', shouldStop: false })
  assert.equal(request.url, 'https://api.openai.com/v1/responses')
  assert.equal(request.init.headers.authorization, 'Bearer server-only')
  const body = JSON.parse(request.init.body)
  assert.equal(body.model, 'gpt-test')
  assert.equal(body.text.format.type, 'json_schema')
  assert.equal(body.text.format.strict, true)
  assert.equal(body.store, false)
  assert.equal(body.instructions, 'workflow instructions')
})

test('OpenAI Responses provider surfaces transient failures for retry classification', async () => {
  const provider = createOpenAiResponsesProvider({ apiKey: 'server-only', fetchImpl: async () => ({ ok: false, status: 429, json: async () => ({ error: { message: 'slow down' } }) }) })
  await assert.rejects(() => provider({ input: 'prompt', model: 'gpt-test', schema: { type: 'object' } }), (error) => error.transient === true && error.status === 429)
})
