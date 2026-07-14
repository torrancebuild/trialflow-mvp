import crypto from 'node:crypto'

export const SESSION_COOKIE = 'trialflow_session'
const SESSION_TTL_SECONDS = 60 * 60 * 8

function secret() {
  const value = process.env.TRIALFLOW_SESSION_SECRET || (process.env.NODE_ENV === 'production' ? '' : 'trialflow-local-development-only-secret')
  if (!value) throw new Error('TRIALFLOW_SESSION_SECRET is not configured')
  return value
}

function encode(value) {
  return Buffer.from(value).toString('base64url')
}

function decode(value) {
  return Buffer.from(value, 'base64url').toString('utf8')
}

function signature(payload) {
  return crypto.createHmac('sha256', secret()).update(payload).digest('base64url')
}

export function json(res, status, body) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(body))
}

export function parseCookies(req) {
  return Object.fromEntries((req.headers.cookie || '').split(';').map((part) => part.trim()).filter(Boolean).map((part) => {
    const index = part.indexOf('=')
    return index === -1 ? [part, ''] : [part.slice(0, index), decodeURIComponent(part.slice(index + 1))]
  }))
}

export function createSession({ email }) {
  const payload = encode(JSON.stringify({ email, exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS }))
  return `${payload}.${signature(payload)}`
}

export function readSession(req) {
  const token = parseCookies(req)[SESSION_COOKIE]
  if (!token) return null
  const [payload, providedSignature] = token.split('.')
  if (!payload || !providedSignature) return null
  const expectedSignature = signature(payload)
  const provided = Buffer.from(providedSignature)
  const expected = Buffer.from(expectedSignature)
  if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) return null
  try {
    const session = JSON.parse(decode(payload))
    return session.exp > Math.floor(Date.now() / 1000) ? session : null
  } catch {
    return null
  }
}

export function requireSession(req, res) {
  const session = readSession(req)
  if (!session) {
    json(res, 401, { error: 'Authentication required' })
    return null
  }
  return session
}

export function setSessionCookie(res, token) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${SESSION_TTL_SECONDS}${secure}`)
}

export function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`)
}

export function configuredCredentials() {
  return {
    email: process.env.TRIALFLOW_DEMO_EMAIL || (process.env.NODE_ENV === 'production' ? '' : 'demo@trialflow.local'),
    password: process.env.TRIALFLOW_DEMO_PASSWORD || (process.env.NODE_ENV === 'production' ? '' : 'trialflow-demo'),
  }
}

export async function readJsonBody(req) {
  if (req.body && typeof req.body === 'object') return req.body
  let raw = ''
  for await (const chunk of req) raw += chunk
  try { return JSON.parse(raw || '{}') } catch { return {} }
}
