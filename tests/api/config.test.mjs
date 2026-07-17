import test from 'node:test'
import assert from 'node:assert/strict'
import { readServerConfig } from '../../server/config.mjs'

const valid = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'public-key',
  SUPABASE_SERVICE_ROLE_KEY: 'server-key',
  WHATSAPP_APP_SECRET: 'app-secret',
  WHATSAPP_WORKSPACE_ID: 'workspace-1',
  WHATSAPP_TOKEN: 'whatsapp-token',
  WHATSAPP_PHONE_NUMBER_ID: 'phone-1',
  WORKER_TOKEN: 'worker-token',
}

test('server configuration requires every production boundary secret', () => {
  assert.deepEqual(readServerConfig(valid), {
    supabaseUrl: valid.SUPABASE_URL,
    supabasePublishableKey: valid.SUPABASE_PUBLISHABLE_KEY,
    supabaseServiceRoleKey: valid.SUPABASE_SERVICE_ROLE_KEY,
    whatsappAppSecret: valid.WHATSAPP_APP_SECRET,
    webhookWorkspaceId: valid.WHATSAPP_WORKSPACE_ID,
    whatsappToken: valid.WHATSAPP_TOKEN,
    whatsappPhoneNumberId: valid.WHATSAPP_PHONE_NUMBER_ID,
    workerToken: valid.WORKER_TOKEN,
    openAiApiKey: undefined,
    openAiBaseUrl: 'https://api.openai.com/v1',
    version: 'local',
  })
  for (const key of Object.keys(valid)) {
    const incomplete = { ...valid }
    delete incomplete[key]
    assert.throws(() => readServerConfig(incomplete), new RegExp(`${key} is required`))
  }
})
