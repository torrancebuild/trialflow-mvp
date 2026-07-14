import { json, requireSession } from './_auth.js'

export default function handler(req, res) {
  const session = requireSession(req, res)
  if (!session) return
  return json(res, 200, { ok: true, user: session.email, scope: 'workflow:read-write' })
}
