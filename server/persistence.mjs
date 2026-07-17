// Server-only Supabase REST adapters. Never import this module into browser code.

const DEFAULT_FETCH = globalThis.fetch

function required(value, name) {
  if (!value || typeof value !== 'string') throw new Error(`${name} is required.`)
  return value
}

function configFromEnv() {
  return {
    url: process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL,
    serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY,
  }
}

function actorId(actor) {
  return actor?.id ?? actor?.userId ?? actor?.user_id ?? null
}

function asArray(value) {
  return Array.isArray(value) ? value : value == null ? [] : [value]
}

function one(value) {
  return Array.isArray(value) ? value[0] ?? null : value ?? null
}

function urlFor(base, path, query) {
  const url = new URL(`${base.replace(/\/$/, '')}/rest/v1/${path}`)
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value))
  }
  return url
}

export class SupabaseRestError extends Error {
  constructor(message, { status, details, path } = {}) {
    super(message)
    this.name = 'SupabaseRestError'
    this.status = status
    this.details = details
    this.path = path
  }
}

export function createSupabaseRestClient({ url, serviceKey, fetchImpl = DEFAULT_FETCH } = {}) {
  const env = configFromEnv()
  const baseUrl = required(url ?? env.url, 'Supabase URL')
  const key = required(serviceKey ?? env.serviceKey, 'Supabase service key')
  if (typeof fetchImpl !== 'function') throw new Error('A fetch implementation is required.')

  async function request(method, path, { query, body, headers = {} } = {}) {
    const response = await fetchImpl(urlFor(baseUrl, path, query), {
      method,
      headers: {
        apikey: key,
        authorization: `Bearer ${key}`,
        accept: 'application/json',
        ...(body === undefined ? {} : { 'content-type': 'application/json', prefer: 'return=representation' }),
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    const text = typeof response.text === 'function' ? await response.text() : ''
    let data = null
    if (text) {
      try { data = JSON.parse(text) } catch { data = text }
    } else if (typeof response.json === 'function' && response.status !== 204) {
      try { data = await response.json() } catch { data = null }
    }
    if (!response.ok) {
      const message = data?.message ?? data?.error_description ?? data?.error ?? `Supabase request failed (${response.status}).`
      throw new SupabaseRestError(message, { status: response.status, details: data, path })
    }
    return data
  }

  return Object.freeze({ request, baseUrl })
}

export function createSupabasePersistence(options = {}) {
  const client = options.request ? options : createSupabaseRestClient(options)
  const request = client.request

  async function recordInboundEvent({ workspaceId, actor, event }) {
    const result = one(await request('POST', 'rpc/ingest_inbound_event', {
      body: {
        target_workspace_id: workspaceId,
        provider_name: event.provider,
        provider_event_id: event.id,
        event_payload: event.raw ?? event,
        external_conversation_id: event.externalConversationId,
        external_message_id: event.externalMessageId ?? event.id,
        message_body: event.text,
        message_occurred_at: event.occurredAt,
      },
    }))
    const stored = { duplicate: Boolean(result?.duplicate), messageId: result?.message_id, conversationId: result?.conversation_id }
    if (!stored.duplicate) await writeAudit({ workspaceId, actor, action: 'inbound_event.recorded', entityType: 'message', entityId: stored.messageId, afterData: event })
    return { ...stored, message: stored.messageId ? { id: stored.messageId } : undefined }
  }

  async function createMessage({ workspaceId, message }) {
    return one(await request('POST', 'messages', { body: { workspace_id: workspaceId, ...message } }))
  }

  async function ensureConversation({ workspaceId, provider = 'whatsapp', externalContactId, customerName, customerPhone }) {
    const rows = await request('POST', 'conversations', {
      query: { on_conflict: 'workspace_id,channel,external_contact_id' },
      headers: { prefer: 'resolution=ignore-duplicates,return=representation' },
      body: { workspace_id: workspaceId, channel: provider, external_contact_id: externalContactId, ...(customerName ? { customer_name: customerName } : {}), ...(customerPhone ? { customer_phone: customerPhone } : {}) },
    })
    if (one(rows)) return one(rows)
    return one(await request('GET', 'conversations', { query: { workspace_id: `eq.${workspaceId}`, channel: `eq.${provider}`, external_contact_id: `eq.${externalContactId}`, limit: 1 } }))
  }

  async function createTask({ workspaceId, task }) {
    return one(await request('POST', 'tasks', { body: { workspace_id: workspaceId, ...task } }))
  }

  async function getTask({ workspaceId, taskId }) {
    return one(await request('GET', 'tasks', { query: { workspace_id: `eq.${workspaceId}`, id: `eq.${taskId}`, limit: 1 } }))
  }

  async function getConversation({ workspaceId, conversationId }) {
    return one(await request('GET', 'conversations', { query: { workspace_id: `eq.${workspaceId}`, id: `eq.${conversationId}`, limit: 1 } }))
  }

  async function getTaskForConversation({ workspaceId, conversationId }) {
    return one(await request('GET', 'tasks', { query: { workspace_id: `eq.${workspaceId}`, conversation_id: `eq.${conversationId}`, limit: 1 } }))
  }

  async function getConversationMessages({ workspaceId, conversationId }) {
    return asArray(await request('GET', 'messages', { query: { workspace_id: `eq.${workspaceId}`, conversation_id: `eq.${conversationId}`, order: 'occurred_at.asc' } }))
  }

  async function createSimulation({ workspaceId, simulation }) {
    return one(await request('POST', 'simulations', { body: { workspace_id: workspaceId, ...simulation } }))
  }

  async function getSimulation({ workspaceId, simulationId }) {
    return one(await request('GET', 'simulations', { query: { workspace_id: `eq.${workspaceId}`, id: `eq.${simulationId}`, limit: 1 } }))
  }

  async function getSimulationForConversation({ workspaceId, conversationId }) {
    return one(await request('GET', 'simulations', { query: { workspace_id: `eq.${workspaceId}`, conversation_id: `eq.${conversationId}`, status: 'not.eq.stopped', order: 'created_at.desc', limit: 1 } }))
  }

  async function updateSimulation({ workspaceId, simulationId, patch }) {
    return one(await request('PATCH', 'simulations', { query: { workspace_id: `eq.${workspaceId}`, id: `eq.${simulationId}` }, body: patch }))
  }

  async function updateTask({ workspaceId, taskId, patch: values }) {
    return one(await request('PATCH', 'tasks', { query: { workspace_id: `eq.${workspaceId}`, id: `eq.${taskId}` }, body: values }))
  }

  async function patchTaskVersion({ taskId, expectedVersion, patch: values }) {
    return one(await request('POST', 'rpc/patch_task_version', { body: { target_task_id: taskId, expected_version: expectedVersion, patch: values } }))
  }

  async function getWorkspaceSnapshot({ workspaceId }) {
    const [workspace, conversations, messages, tasks, availability, auditLogs, outbound, simulations] = await Promise.all([
      request('GET', 'workspaces', { query: { id: `eq.${workspaceId}`, limit: 1 } }),
      request('GET', 'conversations', { query: { workspace_id: `eq.${workspaceId}`, order: 'updated_at.desc' } }),
      request('GET', 'messages', { query: { workspace_id: `eq.${workspaceId}`, order: 'occurred_at.asc' } }),
      request('GET', 'tasks', { query: { workspace_id: `eq.${workspaceId}`, order: 'updated_at.desc' } }),
      request('GET', 'availability_slots', { query: { workspace_id: `eq.${workspaceId}`, status: 'eq.open', order: 'starts_at.asc' } }),
      request('GET', 'audit_logs', { query: { workspace_id: `eq.${workspaceId}`, order: 'created_at.desc', limit: 500 } }),
      request('GET', 'outbound_outbox', { query: { workspace_id: `eq.${workspaceId}`, order: 'created_at.asc' } }),
      request('GET', 'simulations', { query: { workspace_id: `eq.${workspaceId}`, order: 'created_at.desc' } }),
    ])
    return { workspace: one(workspace), conversations: asArray(conversations), messages: asArray(messages), tasks: asArray(tasks), availability: asArray(availability), auditLogs: asArray(auditLogs), outbound: asArray(outbound), simulations: asArray(simulations) }
  }

  async function transitionTask({ workspaceId, taskId, expectedVersion, nextState, actor, eventId, eventType = 'task.transitioned', payload = {} }) {
    const updated = one(await request('POST', 'rpc/transition_task', { body: { target_task_id: taskId, expected_version: expectedVersion, next_state: nextState, p_event_id: eventId, actor_id: actorId(actor), event_payload: payload } }))
    const changed = updated === true || updated?.apply_task_version === true || updated?.result === true
    return { updated: changed, version: changed ? Number(expectedVersion) + 1 : Number(expectedVersion) }
  }

  async function reserveAvailability({ slotId, taskId, reservationKey, customerPhone, holdUntil }) {
    return one(await request('POST', 'rpc/reserve_availability', { body: { target_slot_id: slotId, target_task_id: taskId, reservation_key: reservationKey, target_customer_phone: customerPhone, hold_until: holdUntil } }))
  }

  async function confirmTask({ taskId, expectedVersion, slotId, reservationKey, eventId, actorId: actingUserId, customerPhone }) {
    return one(await request('POST', 'rpc/confirm_task', { body: { target_task_id: taskId, expected_version: expectedVersion, target_slot_id: slotId, reservation_key: reservationKey, p_event_id: eventId, acting_user_id: actingUserId, target_customer_phone: customerPhone } }))
  }

  async function appendTaskEvent({ workspaceId, taskId, eventId, eventType, actor, expectedVersion, payload = {} }) {
    return one(await request('POST', 'task_events', { headers: { prefer: 'resolution=ignore-duplicates,return=representation' }, body: { workspace_id: workspaceId, task_id: taskId, event_id: eventId, event_type: eventType, actor_id: actorId(actor), expected_version: expectedVersion, payload } }))
  }

  async function writeAudit({ workspaceId, actor, action, entityType, entityId = null, correlationId = null, beforeData = null, afterData = null }) {
    return one(await request('POST', 'audit_logs', { body: { workspace_id: workspaceId, actor_id: actorId(actor), action, entity_type: entityType, entity_id: entityId, correlation_id: correlationId, before_data: beforeData, after_data: afterData } }))
  }

  async function recordProviderEvent({ workspaceId, provider, providerEventId, event }) {
    const rows = await request('POST', 'provider_events', { query: { on_conflict: 'workspace_id,provider,provider_event_id' }, headers: { prefer: 'resolution=ignore-duplicates,return=representation' }, body: { workspace_id: workspaceId, provider, provider_event_id: providerEventId, event_type: event.type, payload: event.raw ?? event } })
    return { duplicate: !one(rows), event: one(rows) }
  }

  async function updateDeliveryStatus({ workspaceId, externalMessageId, status, event }) {
    return one(await request('POST', 'rpc/apply_delivery_status', { body: { target_workspace_id: workspaceId, external_message_id: externalMessageId, next_status: status, error_payload: event.error ?? null } }))
  }

  return { recordInboundEvent, recordProviderEvent, updateDeliveryStatus, createMessage, ensureConversation, createTask, getTask, getConversation, getTaskForConversation, getConversationMessages, createSimulation, getSimulation, getSimulationForConversation, updateSimulation, updateTask, patchTaskVersion, getWorkspaceSnapshot, transitionTask, reserveAvailability, confirmTask, appendTaskEvent, writeAudit, client }
}

export function createSupabaseOutbox(options = {}) {
  const client = options.request ? options : createSupabaseRestClient(options)
  const request = client.request

  async function enqueue({ workspaceId, kind, payload = {}, idempotencyKey }) {
    const rows = await request('POST', 'workflow_jobs', {
      query: { on_conflict: 'workspace_id,idempotency_key' },
      headers: { prefer: 'resolution=ignore-duplicates,return=representation' },
      body: { workspace_id: workspaceId, kind, payload, idempotency_key: idempotencyKey, status: 'queued' },
    })
    if (one(rows)) return one(rows)
    return one(await request('GET', 'workflow_jobs', { query: { workspace_id: `eq.${workspaceId}`, idempotency_key: `eq.${idempotencyKey}`, limit: 1 } }))
  }

  async function claim({ workspaceId, limit = 1 }) {
    // Let Postgres evaluate now() so an immediately-created job cannot lose a
    // claim race to clock skew between the API process and the database.
    return asArray(await request('POST', 'rpc/claim_workflow_jobs', { body: { target_workspace_id: workspaceId, take_limit: limit } }))
  }

  async function update({ workspaceId, id, status, lastError, leaseToken, patch = {}, providerMessageId }) {
    const query = { workspace_id: `eq.${workspaceId}`, id: `eq.${id}`, ...(leaseToken ? { lease_token: `eq.${leaseToken}` } : {}) }
    const body = { ...patch, ...(status === undefined ? {} : { status: status === 'sent' ? 'completed' : status }), ...(lastError === undefined ? {} : { last_error: lastError }), ...(providerMessageId ? { provider_message_id: providerMessageId } : {}), ...(status === 'sent' || status === 'failed' ? { lease_token: null, lease_until: null } : {}) }
    return one(await request('PATCH', 'workflow_jobs', { query, body }))
  }

  function createOutboundOutbox() {
    async function enqueueOutbound({ workspaceId, conversationId, taskId = null, provider = 'whatsapp', recipient, body, idempotencyKey }) {
      const rows = await request('POST', 'outbound_outbox', { query: { on_conflict: 'workspace_id,idempotency_key' }, headers: { prefer: 'resolution=ignore-duplicates,return=representation' }, body: { workspace_id: workspaceId, conversation_id: conversationId, task_id: taskId, provider, recipient, body, idempotency_key: idempotencyKey, status: 'queued' } })
      return one(rows) ?? one(await request('GET', 'outbound_outbox', { query: { workspace_id: `eq.${workspaceId}`, idempotency_key: `eq.${idempotencyKey}`, limit: 1 } }))
    }
    async function claimOutbound({ workspaceId, limit = 10 }) {
      return asArray(await request('POST', 'rpc/claim_outbound_messages', { body: { target_workspace_id: workspaceId, take_limit: limit } }))
    }
    async function updateOutbound({ workspaceId, id, leaseToken, status, attempts, error, providerMessageId, nextAttemptAt }) {
      const query = { workspace_id: `eq.${workspaceId}`, id: `eq.${id}`, lease_token: `eq.${leaseToken}` }
      const body = { status, ...(attempts == null ? {} : { attempts }), ...(error ? { last_error: error.message ?? String(error) } : {}), ...(providerMessageId ? { provider_message_id: providerMessageId } : {}), ...(nextAttemptAt ? { available_at: nextAttemptAt } : {}), ...(status === 'sent' || status === 'failed' || status === 'delivered' ? { lease_token: null, lease_until: null } : {}) }
      return one(await request('PATCH', 'outbound_outbox', { query, body }))
    }
    async function markSimulatedSent({ workspaceId, id }) {
      return one(await request('PATCH', 'outbound_outbox', {
        query: { workspace_id: `eq.${workspaceId}`, id: `eq.${id}`, provider: 'eq.simulator', status: 'eq.queued' },
        body: { status: 'sent', updated_at: new Date().toISOString() },
      }))
    }
    return {
      enqueue: enqueueOutbound,
      claim: claimOutbound,
      markSent: ({ id, leaseToken, providerMessageId, workspaceId }) => updateOutbound({ workspaceId, id, leaseToken, status: 'sent', providerMessageId }),
      markRetry: ({ id, leaseToken, attempts, nextAttemptAt, error, workspaceId }) => updateOutbound({ workspaceId, id, leaseToken, status: 'unknown', attempts, nextAttemptAt, error }),
      markFailed: ({ id, leaseToken, attempts, error, workspaceId }) => updateOutbound({ workspaceId, id, leaseToken, status: 'failed', attempts, error }),
      markSimulatedSent,
    }
  }

  return {
    enqueue, claim, update, updateJob: update,
    markSent: ({ id, leaseToken, ...rest }) => update({ ...rest, id, leaseToken, status: 'completed' }),
    markRetry: ({ id, leaseToken, attempts, nextAttemptAt, error, ...rest }) => update({ ...rest, id, leaseToken, status: 'failed', lastError: error?.message, patch: { attempts, available_at: nextAttemptAt } }),
    markFailed: ({ id, leaseToken, attempts, error, ...rest }) => update({ ...rest, id, leaseToken, status: 'failed', lastError: error?.message, patch: { attempts } }),
    client,
    outbound: createOutboundOutbox(),
  }
}

export function createSupabaseAdapters(options = {}) {
  const client = createSupabaseRestClient(options)
  const persistence = createSupabasePersistence(client)
  const outbox = createSupabaseOutbox(client)
  return { persistence, outbox, outboundOutbox: outbox.outbound }
}
