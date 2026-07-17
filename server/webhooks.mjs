import { badRequest } from './errors.mjs'
import { createHmac, timingSafeEqual } from 'node:crypto'

const text = (value) => (typeof value === 'string' ? value : undefined)

export function verifyWhatsAppSignature(rawBody, signature, appSecret) {
  if (typeof rawBody !== 'string' || !signature || !appSecret) return false
  const supplied = String(signature).replace(/^sha256=/i, '')
  if (!/^[a-f0-9]{64}$/i.test(supplied)) return false
  const expected = createHmac('sha256', appSecret).update(rawBody, 'utf8').digest('hex')
  return timingSafeEqual(Buffer.from(supplied, 'hex'), Buffer.from(expected, 'hex'))
}

export function normalizeWebhookEvent(payload, { provider = 'whatsapp' } = {}) {
  if (!payload || typeof payload !== 'object') throw badRequest('Webhook payload must be an object.')
  if (provider !== 'whatsapp') throw badRequest(`Unsupported webhook provider: ${provider}.`)

  const value = payload.entry?.[0]?.changes?.[0]?.value
  const message = value?.messages?.[0]
  if (!message?.id || !message.from || !message.timestamp) {
    throw badRequest('Webhook payload does not contain a supported inbound message.')
  }
  const contact = value.contacts?.find((item) => item.wa_id === message.from)
  const body = message.text?.body ?? message.button?.text ?? message.interactive?.button_reply?.title
  if (!text(body) || !body.trim()) throw badRequest('Inbound message has no supported text body.')

  return {
    id: String(message.id),
    provider,
    type: 'message.received',
    occurredAt: new Date(Number(message.timestamp) * 1000).toISOString(),
    externalConversationId: String(message.from),
    externalMessageId: String(message.id),
    sender: { id: String(message.from), name: contact?.profile?.name },
    text: body.trim(),
    raw: payload,
  }
}
