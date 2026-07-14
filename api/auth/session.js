import { json, readSession } from '../_auth.js'

export default function handler(req, res) {
  const session = readSession(req)
  if (!session) return json(res, 401, { authenticated: false })
  return json(res, 200, { authenticated: true, user: { email: session.email, name: 'Alex Chen', role: 'Manager' } })
}
