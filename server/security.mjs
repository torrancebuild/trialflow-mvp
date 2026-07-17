import { createHash } from 'node:crypto'

const SENSITIVE_KEYS = /(?:password|passcode|secret|token|authorization|cookie|api[_-]?key|access[_-]?token|refresh[_-]?token|phone|mobile|email|address|name|contact|message|body|text|raw)/i
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi
const PHONE = /(?<!\w)(?:\+?\d[\d\s().-]{6,}\d)(?!\w)/g

function stableDigest(value) {
  return createHash('sha256').update(String(value)).digest('hex').slice(0, 12)
}

function redactString(value) {
  return value.replace(EMAIL, '[REDACTED_EMAIL]').replace(PHONE, '[REDACTED_PHONE]')
}

/** Return a copy safe to include in logs, traces, and audit metadata. */
export function redactPii(value, { redactKeys = SENSITIVE_KEYS } = {}) {
  if (typeof value === 'string') return redactString(value)
  if (Array.isArray(value)) return value.map((item) => redactPii(item, { redactKeys }))
  if (!value || typeof value !== 'object') return value

  const result = {}
  for (const [key, item] of Object.entries(value)) {
    result[key] = redactKeys.test(key) ? '[REDACTED]' : redactPii(item, { redactKeys })
  }
  return result
}

export function redactIdentifier(value) {
  return value == null ? undefined : `sha256:${stableDigest(value)}`
}

export function createStructuredLog({ sink = console } = {}) {
  const write = (level, event, details = {}) => {
    const record = { timestamp: new Date().toISOString(), level, event, ...redactPii(details) }
    const target = typeof sink === 'function' ? sink : sink?.[level] ?? sink?.log
    if (typeof target === 'function') target.call(typeof sink === 'object' ? sink : undefined, record)
    return record
  }
  return Object.freeze({
    debug: (event, details) => write('debug', event, details),
    info: (event, details) => write('info', event, details),
    warn: (event, details) => write('warn', event, details),
    error: (event, details) => write('error', event, details),
  })
}

export function createAuditLogger({ sink = () => {}, clock = () => new Date() } = {}) {
  return (event, details = {}) => {
    const record = { timestamp: clock().toISOString(), event, ...redactPii(details) }
    sink(record)
    return record
  }
}

export const audit = (sink, event, details) => createAuditLogger({ sink })(event, details)
