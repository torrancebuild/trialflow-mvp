import { clearSessionCookie, json } from '../_auth.js'

export default function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' })
  clearSessionCookie(res)
  return json(res, 200, { authenticated: false })
}
