import { json } from './_auth.js'

export default function handler(req, res) {
  return json(res, 200, { ok: true, service: 'trialflow', timestamp: new Date().toISOString() })
}
