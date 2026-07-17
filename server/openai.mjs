const DEFAULT_BASE_URL = 'https://api.openai.com/v1'

function apiError(response, body) {
  const error = new Error(body?.error?.message ?? `OpenAI request failed (${response.status}).`)
  error.status = response.status
  error.code = body?.error?.code ?? 'OPENAI_REQUEST_FAILED'
  error.transient = response.status === 408 || response.status === 429 || response.status >= 500
  return error
}

function extractJson(response) {
  if (typeof response?.output_text === 'string' && response.output_text.trim()) return JSON.parse(response.output_text)
  const text = response?.output?.flatMap((item) => item?.type === 'message' ? item.content ?? [] : []).find((item) => item?.type === 'output_text')?.text
  if (typeof text !== 'string' || !text.trim()) {
    const refusal = response?.output?.flatMap((item) => item?.content ?? []).find((item) => item?.type === 'refusal')?.refusal
    const error = new Error(refusal || 'OpenAI response did not contain structured output.')
    error.code = refusal ? 'OPENAI_REFUSAL' : 'OPENAI_EMPTY_OUTPUT'
    throw error
  }
  return JSON.parse(text)
}

/** Server-only OpenAI Responses API provider for createLlmAdapter. */
export function createOpenAiResponsesProvider({ apiKey = process.env.OPENAI_API_KEY, baseUrl = process.env.OPENAI_API_BASE_URL ?? DEFAULT_BASE_URL, instructions, fetchImpl = globalThis.fetch } = {}) {
  if (!apiKey) throw new Error('OpenAI API key is required.')
  if (typeof fetchImpl !== 'function') throw new Error('A fetch implementation is required.')
  return async ({ input, schema, model }) => {
    const payload = { model, input: typeof input === 'string' ? input : JSON.stringify(input), text: { format: { type: 'json_schema', name: 'messageops_output', strict: true, schema } }, store: false }
    if (instructions) payload.instructions = instructions
    const response = await fetchImpl(`${baseUrl.replace(/\/$/, '')}/responses`, {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const body = await response.json().catch(() => ({}))
    if (!response.ok) throw apiError(response, body)
    return extractJson(body)
  }
}
