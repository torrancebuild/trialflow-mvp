import { createSupabaseAuthProvider } from './auth.mjs'
import { createSupabaseAdapters } from './persistence.mjs'
import { createApiService } from './service.mjs'
import { createStructuredLlmAdapter } from './llm.mjs'
import { createDeliveryReconciler } from './whatsapp.mjs'
import { createWhatsAppClient } from './whatsapp.mjs'
import { createHttpHandler } from './http.mjs'
import { healthCheck } from './ops.mjs'
import { createRuntime } from './runtime.mjs'
import { createCustomerSimulator, customerMessageSchema } from './simulator.mjs'
import { createOpenAiResponsesProvider } from './openai.mjs'
import { workflowUnderstandingSchema } from './processor.mjs'

const WORKFLOW_LLM_INSTRUCTIONS = [
  'You are the operations assistant for a trial-booking support team.',
  'Read the latest customer message and conversation context.',
  'Extract only the customer fields needed for booking: childAge, location, preferredDays, and preferredTime.',
  'Use null for an unavailable scalar field and [] for unavailable preferredDays.',
  'Classify intent as exactly one of: new_trial_inquiry, existing_booking_question, reschedule_request, faq, unknown.',
  'Return confidence as a number from 0 to 1.',
  'Draft a concise, natural reply that asks for missing information or advances the booking workflow.',
  'Do not invent availability, confirmations, prices, or policy exceptions.',
  'Return only the requested structured object.',
].join(' ')

const required = (env, name) => {
  const value = env[name]?.trim()
  if (!value) throw new Error(`${name} is required for the server runtime.`)
  return value
}

export function readServerConfig(env = process.env) {
  return Object.freeze({
    supabaseUrl: required(env, 'SUPABASE_URL'),
    supabasePublishableKey: required(env, 'SUPABASE_PUBLISHABLE_KEY'),
    supabaseServiceRoleKey: required(env, 'SUPABASE_SERVICE_ROLE_KEY'),
    whatsappAppSecret: required(env, 'WHATSAPP_APP_SECRET'),
    webhookWorkspaceId: required(env, 'WHATSAPP_WORKSPACE_ID'),
    whatsappToken: required(env, 'WHATSAPP_TOKEN'),
    whatsappPhoneNumberId: required(env, 'WHATSAPP_PHONE_NUMBER_ID'),
    workerToken: required(env, 'WORKER_TOKEN'),
    openAiApiKey: env.OPENAI_API_KEY?.trim(),
    openAiBaseUrl: env.OPENAI_API_BASE_URL?.trim() || 'https://api.openai.com/v1',
    version: env.APP_VERSION?.trim() || 'local',
  })
}

export function createProductionHandler({ env = process.env, fetchImpl = globalThis.fetch, llmProvider, customerLlmProvider, availability } = {}) {
  const config = readServerConfig(env)
  const adapters = createSupabaseAdapters({ url: config.supabaseUrl, serviceKey: config.supabaseServiceRoleKey, fetchImpl })
  const authProvider = createSupabaseAuthProvider({ url: config.supabaseUrl, publishableKey: config.supabasePublishableKey, fetchImpl })
  const membershipStore = {
    async getMembership({ workspaceId, userId }) {
      const rows = await adapters.persistence.client.request('GET', 'workspace_members', {
        query: { workspace_id: `eq.${workspaceId}`, user_id: `eq.${userId}`, select: 'workspace_id,user_id,role', limit: 1 },
      })
      return Array.isArray(rows) ? rows[0] ?? null : rows ?? null
    },
  }
  const llm = createStructuredLlmAdapter({
    provider: llmProvider ?? (config.openAiApiKey ? createOpenAiResponsesProvider({ apiKey: config.openAiApiKey, baseUrl: config.openAiBaseUrl, instructions: WORKFLOW_LLM_INSTRUCTIONS, fetchImpl }) : async () => { throw new Error('LLM provider is not configured.') }),
    schema: workflowUnderstandingSchema,
    model: env.LLM_MODEL?.trim() || 'unconfigured',
    promptVersion: env.LLM_PROMPT_VERSION?.trim() || 'unconfigured',
  })
  const customerLlm = createStructuredLlmAdapter({
    provider: customerLlmProvider ?? (config.openAiApiKey ? createOpenAiResponsesProvider({ apiKey: config.openAiApiKey, baseUrl: config.openAiBaseUrl, fetchImpl }) : async () => { throw new Error('Customer LLM provider is not configured.') }),
    schema: customerMessageSchema,
    model: env.SIMULATOR_LLM_MODEL?.trim() || env.LLM_MODEL?.trim() || 'gpt-5.6',
    promptVersion: env.SIMULATOR_LLM_PROMPT_VERSION?.trim() || 'simulator-v1',
  })
  const processor = {
    process: async ({ workspaceId, event }) => {
      const { createInboundProcessor } = await import('./processor.mjs')
      const findAvailability = availability ?? (async ({ workspaceId: targetWorkspaceId }) => adapters.persistence.client.request('GET', 'availability_slots', {
        query: { workspace_id: `eq.${targetWorkspaceId}`, status: 'eq.open', order: 'starts_at.asc' },
      }))
      return createInboundProcessor({ persistence: adapters.persistence, llm, availability: findAvailability }).process({ workspaceId, event })
    },
  }
  let service
  const simulator = createCustomerSimulator({
    llm: customerLlm,
    persistence: adapters.persistence,
    ingestMessage: (input) => service.ingestSimulatorMessage(input),
  })
  service = createApiService({
    authProvider,
    membershipStore,
    persistence: adapters.persistence,
    outbox: adapters.outbox,
    processor,
    whatsappAppSecret: config.whatsappAppSecret,
    resolveWebhookWorkspace: async () => config.webhookWorkspaceId,
    deliveryReconciler: createDeliveryReconciler({ repository: adapters.persistence }),
    simulator,
  })
  const runtime = createRuntime({ workflowOutbox: adapters.outbox, outboundOutbox: adapters.outboundOutbox, processor, whatsappClient: createWhatsAppClient({ accessToken: config.whatsappToken, phoneNumberId: config.whatsappPhoneNumberId, fetchImpl }) })
  const handler = createHttpHandler({
    service,
    version: config.version,
    health: () => healthCheck({
      version: config.version,
      db: async () => { await adapters.persistence.client.request('GET', 'workspaces', { query: { select: 'id', limit: 1 } }); return true },
      provider: async () => Boolean(config.whatsappAppSecret && config.webhookWorkspaceId),
    }),
  })
  handler.runWorkers = runtime.runOnce
  handler.workerToken = config.workerToken
  return handler
}
