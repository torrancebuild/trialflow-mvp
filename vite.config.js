import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { createStructuredLlmAdapter } from './server/llm.mjs'
import { createOpenAiResponsesProvider } from './server/openai.mjs'
import { workflowUnderstandingSchema } from './server/processor.mjs'

const WORKFLOW_LLM_INSTRUCTIONS = [
  'You are the operations assistant for a trial-booking support team.',
  'Read the customer conversation and classify the customer intent.',
  'Extract only childAge, location, preferredDays, and preferredTime needed for booking.',
  'Use null for unavailable scalar fields and [] for unavailable preferredDays.',
  'Return a concise draft reply, but do not invent availability, confirmations, prices, or policy exceptions.',
  'Return only the requested structured object.',
].join(' ')

const localEnv = loadEnv('development', process.cwd(), '')
const envValue = (name) => process.env[name] || localEnv[name]

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let raw = ''
    request.on('data', (chunk) => { raw += chunk })
    request.on('end', () => {
      try { resolve(JSON.parse(raw || '{}')) } catch { reject(new Error('Request body must be valid JSON.')) }
    })
    request.on('error', reject)
  })
}

async function handleLocalUnderstanding(request, response) {
  if (request.method !== 'POST') { response.statusCode = 405; response.end(); return }
  if (!envValue('OPENAI_API_KEY')) {
    response.statusCode = 503
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify({ message: 'Live LLM is not configured. Set OPENAI_API_KEY in the server environment.' }))
    return
  }
  try {
    const body = await readJsonBody(request)
    const messages = Array.isArray(body.messages) ? body.messages : []
    if (!messages.length) throw new Error('At least one customer message is required.')
    const provider = createOpenAiResponsesProvider({ apiKey: envValue('OPENAI_API_KEY'), baseUrl: envValue('OPENAI_API_BASE_URL'), instructions: WORKFLOW_LLM_INSTRUCTIONS })
    const llm = createStructuredLlmAdapter({ provider, schema: workflowUnderstandingSchema, model: envValue('LLM_MODEL') || 'gpt-5.4', promptVersion: envValue('LLM_PROMPT_VERSION') || 'workflow-v2' })
    const result = await llm.complete({ messages: messages.map(({ direction, text }) => ({ direction, text })) }, { confidence: true })
    if (result.status !== 'ok') { response.statusCode = 502; response.setHeader('content-type', 'application/json'); response.end(JSON.stringify({ message: 'The live LLM could not classify this message.' })); return }
    response.statusCode = 200
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify(result.output))
  } catch (error) {
    response.statusCode = 500
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify({ message: error.message }))
  }
}

function localUnderstandingPlugin() {
  return {
    name: 'local-understanding-api',
    configureServer(server) {
      server.middlewares.use('/api/local/understand', handleLocalUnderstanding)
    },
  }
}

export default defineConfig({
  plugins: [react(), localUnderstandingPlugin()],
})
