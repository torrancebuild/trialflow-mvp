import { configuredCredentials, createSession, json, readJsonBody, setSessionCookie } from '../_auth.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' })
  const { email, password } = await readJsonBody(req)
  const credentials = configuredCredentials()
  if (!credentials.email || !credentials.password || email !== credentials.email || password !== credentials.password) {
    return json(res, 401, { error: 'Invalid email or password' })
  }
  setSessionCookie(res, createSession({ email }))
  return json(res, 200, { authenticated: true, user: { email, name: 'Alex Chen', role: 'Manager' } })
}
