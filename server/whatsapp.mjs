import { badRequest } from './errors.mjs'

const DEFAULT_API_VERSION = 'v20.0'
const DEFAULT_GRAPH_URL = 'https://graph.facebook.com'
const STATUSES = new Set(['sent', 'delivered', 'read', 'failed'])

export class WhatsAppProviderError extends Error {
  constructor(message, { status, code, type, details, transient = false } = {}) {
    super(message)
    this.name = 'WhatsAppProviderError'
    this.status = status
    this.code = code
    this.type = type
    this.details = details
    this.transient = transient
  }
}

const providerError = async (response) => {
  let body
  try { body = await response.json() } catch { body = undefined }
  const error = body?.error ?? {}
  const status = response.status
  return new WhatsAppProviderError(error.message ?? `WhatsApp API request failed (${status}).`, {
    status,
    code: error.code,
    type: error.type,
    details: error.error_data ?? body,
    transient: status === 408 || status === 429 || status >= 500,
  })
}

const assertRecipient = (to) => {
  if (typeof to !== 'string' || !to.trim()) throw badRequest('WhatsApp recipient is required.')
  return to.replace(/[^\d+]/g, '')
}

export function createWhatsAppClient({ accessToken = process.env.WHATSAPP_TOKEN, phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID, apiVersion = process.env.WHATSAPP_API_VERSION ?? DEFAULT_API_VERSION, graphUrl = process.env.WHATSAPP_GRAPH_URL ?? DEFAULT_GRAPH_URL, fetchImpl = globalThis.fetch } = {}) {
  if (!accessToken) throw new Error('WhatsApp access token is required.')
  if (!phoneNumberId) throw new Error('WhatsApp phone number ID is required.')
  if (typeof fetchImpl !== 'function') throw new Error('A fetch implementation is required.')
  const endpoint = `${graphUrl.replace(/\/$/, '')}/${apiVersion}/${phoneNumberId}/messages`

  const sendMessage = async (message, { idempotencyKey, signal } = {}) => {
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json',
        ...(idempotencyKey ? { 'x-idempotency-key': idempotencyKey } : {}),
      },
      body: JSON.stringify(message),
      signal,
    })
    if (!response.ok) throw await providerError(response)
    const body = await response.json()
    const messageId = body?.messages?.[0]?.id
    if (!messageId) throw new WhatsAppProviderError('WhatsApp API response did not contain a message ID.', { status: response.status, details: body, transient: true })
    return { provider: 'whatsapp', providerMessageId: String(messageId), ...body }
  }

  return Object.freeze({
    endpoint,
    sendMessage,
    sendText: (to, text, options) => sendMessage({ messaging_product: 'whatsapp', recipient_type: 'individual', to: assertRecipient(to), type: 'text', text: { preview_url: false, body: String(text) } }, options),
    sendTemplate: (to, name, languageCode = 'en_US', components = [], options) => sendMessage({ messaging_product: 'whatsapp', recipient_type: 'individual', to: assertRecipient(to), type: 'template', template: { name, language: { code: languageCode }, ...(components.length ? { components } : {}) } }, options),
  })
}

export function normalizeDeliveryStatus(status, { provider = 'whatsapp' } = {}) {
  const value = status?.entry?.[0]?.changes?.[0]?.value?.statuses?.[0] ?? status?.statuses?.[0] ?? status
  const raw = value?.status ?? value?.state
  const normalized = String(raw ?? '').toLowerCase()
  if (!STATUSES.has(normalized) || !value?.id) throw badRequest('Unsupported WhatsApp delivery status.')
  const timestamp = value.timestamp == null ? undefined : new Date(Number(value.timestamp) * 1000).toISOString()
  return {
    id: `${provider}:${value.id}:${normalized}:${value.timestamp ?? ''}`,
    provider,
    type: `message.${normalized}`,
    status: normalized,
    occurredAt: timestamp ?? new Date().toISOString(),
    externalMessageId: String(value.id),
    recipientId: value.recipient_id ? String(value.recipient_id) : undefined,
    error: value.errors?.[0] ? { code: value.errors[0].code, title: value.errors[0].title, message: value.errors[0].message } : undefined,
    raw: status,
  }
}

export function createDeliveryReconciler({ repository }) {
  if (!repository?.recordProviderEvent || !repository?.updateDeliveryStatus) throw new Error('Delivery repository must implement recordProviderEvent and updateDeliveryStatus.')
  return {
    async reconcile(input, options) {
      const event = normalizeDeliveryStatus(input, options)
      const recorded = await repository.recordProviderEvent({ workspaceId: options?.workspaceId, provider: event.provider, providerEventId: event.id, event })
      if (recorded?.duplicate) return { event, duplicate: true }
      const updated = await repository.updateDeliveryStatus({ workspaceId: options?.workspaceId, provider: event.provider, externalMessageId: event.externalMessageId, status: event.status, event })
      return { event, duplicate: false, updated }
    },
  }
}
