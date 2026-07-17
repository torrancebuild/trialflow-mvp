import { createWorkspaceView } from './workspace'

const workspaceId = import.meta.env.VITE_SUPABASE_WORKSPACE_ID?.trim()
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim()
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim()

export const isServerBacked = Boolean(workspaceId && supabaseUrl && supabaseKey)

async function request(path, { token, method = 'GET', body } = {}) {
  const response = await fetch(`${path}${path.includes('?') ? '&' : '?'}workspace_id=${encodeURIComponent(workspaceId)}`, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.message || data.error || `Server request failed (${response.status}).`)
  return data
}

export async function loadWorkspace(token) {
  return createWorkspaceView(await request('/api/workspace', { token }))
}

export async function persistTaskChange(token, task, previousTask, event = {}) {
  if (!task?.id) return
  const path = `/api/workspace/tasks/${encodeURIComponent(task.id)}/actions`
  const eventId = `ui:${task.id}:${task.version ?? Date.now()}:${event.type || 'update'}`
  if (event.type === 'CONFIRM_BOOKING') {
    const result = await request(path, { token, method: 'POST', body: { action: 'confirm', payload: { slotId: task.selectedSlotId, reservationKey: eventId, eventId, expectedVersion: Number(previousTask?.version ?? task.version ?? 1) } } })
    return { version: result.task_version ?? task.version }
  }
  if (event.type === 'SEND_REPLY') {
    return request(path, { token, method: 'POST', body: { action: 'send', payload: { expectedVersion: Number(previousTask?.version ?? task.version ?? 1), idempotencyKey: `reply:${task.id}:${task.version ?? 1}` } } })
  }
  if (event.type === 'TAKE_OVER') {
    const result = await request(path, { token, method: 'POST', body: { action: 'takeover', payload: { expectedVersion: Number(previousTask?.version ?? task.version ?? 1) } } })
    return { version: result.version ?? task.version }
  }
  if (task.state !== previousTask?.state) {
    const result = await request(path, { token, method: 'POST', body: { action: 'transition', payload: { expectedVersion: Number(previousTask?.version ?? task.version ?? 1), nextState: task.state, eventId, eventPayload: { source: 'operator_console', event: event.type } } } })
    await request(path, { token, method: 'POST', body: { action: 'update', payload: { expectedVersion: result.version, extracted_fields: task.extractedFields, missing_fields: task.missingFields, suggested_slots: task.suggestedSlots, selected_slot_id: task.selectedSlotId, draft_reply: task.draftReply, draft_status: task.draftStatus } } })
    return { version: result.version ?? task.version }
  }
  const result = await request(path, { token, method: 'POST', body: {
    action: 'update',
    payload: { expectedVersion: Number(previousTask?.version ?? task.version ?? 1), extracted_fields: task.extractedFields, missing_fields: task.missingFields, suggested_slots: task.suggestedSlots, selected_slot_id: task.selectedSlotId, draft_reply: task.draftReply, draft_status: task.draftStatus },
  } })
  return { version: result.version ?? task.version }
}

export function startSimulation(token, scenario) {
  return request('/api/demo/simulations', { token, method: 'POST', body: { scenario } })
}

export function nextSimulation(token, simulationId, lastOpsReply = '') {
  return request(`/api/demo/simulations/${encodeURIComponent(simulationId)}/next`, { token, method: 'POST', body: { lastOpsReply } })
}

export async function understandConversation(messages) {
  const response = await fetch('/api/local/understand', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ messages }),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.message || `Live LLM request failed (${response.status}).`)
  return data
}
