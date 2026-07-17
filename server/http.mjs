import { createApiService } from './service.mjs'
import { healthCheck } from './ops.mjs'

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

export function createHttpHandler({ service, health = healthCheck, version = 'unknown' } = {}) {
  if (!service || typeof service.ingestWebhook !== 'function') throw new Error('An API service is required.')
  return async function handle(request) {
    const url = new URL(request.url)
    if (request.method === 'GET' && url.pathname === '/health') return json(await health({ version }))
    if (url.pathname === '/workspace' || url.pathname === '/api/workspace') {
      if (request.method === 'GET') {
        try {
          const snapshot = await service.getWorkspaceSnapshot({ request, workspaceId: url.searchParams.get('workspace_id') })
          return json(snapshot)
        } catch (error) {
          return json({ error: error.code ?? 'WORKSPACE_READ_FAILED', message: error.message }, error.status ?? 500)
        }
      }
    }
    if (url.pathname === '/api/demo/simulations' && request.method === 'POST') {
      let body
      try { body = JSON.parse(await request.text()) } catch { return json({ error: 'invalid_json' }, 400) }
      try { return json(await service.startSimulation({ request, workspaceId: url.searchParams.get('workspace_id'), scenario: body?.scenario })) } catch (error) { return json({ error: error.code ?? 'SIMULATION_START_FAILED', message: error.message }, error.status ?? 500) }
    }
    const nextSimulationMatch = url.pathname.match(/^\/api\/demo\/simulations\/([^/]+)\/next$/)
    if (nextSimulationMatch && request.method === 'POST') {
      let body = {}
      try { const raw = await request.text(); body = raw ? JSON.parse(raw) : {} } catch { return json({ error: 'invalid_json' }, 400) }
      try { return json(await service.nextSimulation({ request, workspaceId: url.searchParams.get('workspace_id'), simulationId: nextSimulationMatch[1], lastOpsReply: body?.lastOpsReply })) } catch (error) { return json({ error: error.code ?? 'SIMULATION_NEXT_FAILED', message: error.message }, error.status ?? 500) }
    }
    const transitionMatch = url.pathname.match(/^(?:\/api)?\/workspace\/tasks\/([^/]+)\/transition$/)
    if (transitionMatch && request.method === 'POST') {
      const rawBody = await request.text()
      let body
      try { body = JSON.parse(rawBody) } catch { return json({ error: 'invalid_json' }, 400) }
      try {
        const result = await service.transitionTask({ request, workspaceId: url.searchParams.get('workspace_id'), taskId: url.searchParams.get('task_id') ?? transitionMatch[1], ...body })
        return json(result)
      } catch (error) {
        return json({ error: error.code ?? 'TASK_TRANSITION_FAILED', message: error.message }, error.status ?? 500)
      }
    }
    const actionMatch = url.pathname.match(/^(?:\/api)?\/workspace\/tasks\/([^/]+)\/actions$/)
    if (actionMatch && request.method === 'POST') {
      const rawBody = await request.text()
      let body
      try { body = JSON.parse(rawBody) } catch { return json({ error: 'invalid_json' }, 400) }
      try {
        const result = await service.executeTaskAction({ request: { ...request, rawBody, headers: request.headers }, workspaceId: url.searchParams.get('workspace_id'), taskId: actionMatch[1], action: body.action, payload: body.payload })
        return json(result)
      } catch (error) {
        return json({ error: error.code ?? 'TASK_ACTION_FAILED', message: error.message }, error.status ?? 500)
      }
    }
    if (request.method !== 'POST' || !['/webhooks/whatsapp', '/webhooks/whatsapp/delivery'].includes(url.pathname)) return json({ error: 'not_found' }, 404)
    const rawBody = await request.text()
    let payload
    try { payload = JSON.parse(rawBody) } catch { return json({ error: 'invalid_json' }, 400) }
    try {
      const result = url.pathname.endsWith('/delivery')
        ? await service.ingestDeliveryWebhook({
          request: { rawBody, headers: Object.fromEntries(request.headers.entries()) },
          payload,
          provider: 'whatsapp',
        })
        : await service.ingestWebhook({
        request: { rawBody, headers: Object.fromEntries(request.headers.entries()) },
        workspaceId: url.searchParams.get('workspace_id') ?? undefined,
        payload,
        provider: 'whatsapp',
      })
      return json(result, 202)
    } catch (error) {
      return json({ error: error.code ?? 'WEBHOOK_REJECTED', message: error.message }, error.status ?? 400)
    }
  }
}
