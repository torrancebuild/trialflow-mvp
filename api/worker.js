import { createProductionHandler } from '../server/config.mjs'

let handlerPromise

export default async function worker(req, res) {
  try {
    const handler = await (handlerPromise ??= Promise.resolve().then(() => createProductionHandler()))
    const supplied = req.headers['x-worker-token']
    if (!supplied || supplied !== handler.workerToken) {
      res.statusCode = 401
      res.end(JSON.stringify({ error: 'UNAUTHORIZED' }))
      return
    }
    const workspaceId = req.query?.workspace_id || process.env.WHATSAPP_WORKSPACE_ID
    const result = await handler.runWorkers({ workspaceId, limit: 10 })
    res.statusCode = 200
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ ok: true, result }))
  } catch (error) {
    res.statusCode = error.status ?? 500
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ error: error.code ?? 'WORKER_FAILED', message: error.message }))
  }
}
