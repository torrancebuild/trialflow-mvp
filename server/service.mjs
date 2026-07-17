import { authenticate, bearerToken } from './auth.mjs'
import { authorizeWorkspace } from './authorization.mjs'
import { normalizeWebhookEvent, verifyWhatsAppSignature } from './webhooks.mjs'
import { normalizeDeliveryStatus } from './whatsapp.mjs'
import { badRequest, conflict, forbidden } from './errors.mjs'
import { SIMULATOR_PROVIDER } from './simulator.mjs'

export function createApiService({ authProvider, membershipStore, persistence, outbox, processor, whatsappAppSecret, resolveWebhookWorkspace, deliveryReconciler, simulator }) {
  if (!persistence || typeof persistence.recordInboundEvent !== 'function') {
    throw new Error('Persistence must implement recordInboundEvent.')
  }
  if (!outbox || typeof outbox.enqueue !== 'function') throw new Error('Outbox must implement enqueue.')
  if (!processor || typeof processor.process !== 'function') throw new Error('Processor must implement process.')

  return {
    async getWorkspaceSnapshot({ request, workspaceId }) {
      const principal = await authenticate(request, authProvider)
      const actor = await authorizeWorkspace({ principal, workspaceId, membershipStore, roles: ['manager', 'operator'] })
      return persistence.getWorkspaceSnapshot({ workspaceId, actor })
    },

    async updateTask({ request, workspaceId, taskId, patch }) {
      const principal = await authenticate(request, authProvider)
      const actor = await authorizeWorkspace({ principal, workspaceId, membershipStore, roles: ['manager', 'operator'] })
      return persistence.updateTask({ workspaceId, taskId, patch, actor })
    },

    async transitionTask({ request, workspaceId, taskId, expectedVersion, nextState, eventId, payload }) {
      const principal = await authenticate(request, authProvider)
      const actor = await authorizeWorkspace({ principal, workspaceId, membershipStore, roles: ['manager', 'operator'] })
      if (nextState === 'confirmed') throw forbidden('Use the confirmation command to reserve and confirm atomically.')
      if (!eventId) throw badRequest('eventId is required.')
      const result = await persistence.transitionTask({ workspaceId, taskId, expectedVersion, nextState, actor, eventId, payload })
      if (!result.updated) throw conflict()
      return result
    },

    async executeTaskAction({ request, workspaceId, taskId, action, payload = {} }) {
      const principal = await authenticate(request, authProvider)
      const actor = await authorizeWorkspace({ principal, workspaceId, membershipStore, roles: ['manager', 'operator'] })
      const task = await persistence.getTask({ workspaceId, taskId })
      if (!task) throw badRequest('Task not found.')

      if (action === 'update') {
        const allowed = ['extracted_fields', 'missing_fields', 'suggested_slots', 'selected_slot_id', 'draft_reply', 'draft_status']
        const patch = Object.fromEntries(allowed.filter((key) => Object.prototype.hasOwnProperty.call(payload, key)).map((key) => [key, payload[key]]))
        if (!Object.keys(patch).length) throw badRequest('No editable task fields were supplied.')
        if (payload.expectedVersion == null || Number(payload.expectedVersion) !== Number(task.version)) throw conflict()
        const updated = await persistence.patchTaskVersion({ taskId, expectedVersion: payload.expectedVersion, patch, actor })
        if (!updated) throw conflict()
        return updated
      }

      if (action === 'confirm') {
        if (actor.role !== 'manager') throw forbidden('Manager approval is required to confirm a booking.')
        if (!payload.slotId || !payload.reservationKey || !payload.eventId || payload.expectedVersion == null) throw badRequest('slotId, reservationKey, eventId, and expectedVersion are required.')
        const conversation = await persistence.getConversation({ workspaceId, conversationId: task.conversation_id })
        return persistence.confirmTask({ taskId, expectedVersion: payload.expectedVersion, slotId: payload.slotId, reservationKey: payload.reservationKey, eventId: payload.eventId, actorId: actor.id, customerPhone: conversation?.customer_phone })
      }

      if (action === 'send') {
        if (payload.expectedVersion == null || Number(payload.expectedVersion) !== Number(task.version)) throw conflict()
        if (task.draft_status !== 'approved') throw forbidden('The current draft must be approved before sending.')
        const conversation = await persistence.getConversation({ workspaceId, conversationId: task.conversation_id })
        if (!conversation?.customer_phone) throw badRequest('The conversation has no customer phone number.')
        const queued = await outbox.outbound.enqueue({ workspaceId, conversationId: task.conversation_id, taskId, provider: conversation.channel === SIMULATOR_PROVIDER ? SIMULATOR_PROVIDER : 'whatsapp', recipient: conversation.customer_phone, body: task.draft_reply, idempotencyKey: payload.idempotencyKey ?? `reply:${task.id}:${task.version}` })
        let customerTurn
        if (conversation.channel === SIMULATOR_PROVIDER && simulator) {
          await outbox.outbound.markSimulatedSent?.({ workspaceId, id: queued?.id })
          const activeSimulation = await persistence.getSimulationForConversation({ workspaceId, conversationId: task.conversation_id })
          if (activeSimulation) customerTurn = await simulator.next({ workspaceId, simulationId: activeSimulation.id, lastOpsReply: task.draft_reply })
        }
        return { queued, customerTurn }
      }

      if (action === 'takeover') {
        if (payload.expectedVersion == null || Number(payload.expectedVersion) !== Number(task.version)) throw conflict()
        const updated = await persistence.patchTaskVersion({ taskId, expectedVersion: payload.expectedVersion, patch: { assigned_to: actor.id }, actor })
        if (!updated) throw conflict()
        return updated
      }

      if (action === 'transition') {
        if (!payload.nextState || !payload.eventId) throw badRequest('nextState and eventId are required.')
        const result = await persistence.transitionTask({ workspaceId, taskId, expectedVersion: payload.expectedVersion ?? task.version, nextState: payload.nextState, actor, eventId: payload.eventId, payload: payload.eventPayload ?? {} })
        if (!result.updated) throw conflict()
        return result
      }

      throw badRequest(`Unsupported task action: ${action}.`)
    },

    async startSimulation({ request, workspaceId, scenario }) {
      const principal = await authenticate(request, authProvider)
      const actor = await authorizeWorkspace({ principal, workspaceId, membershipStore, roles: ['manager', 'operator'] })
      if (!simulator) throw badRequest('Customer simulator is not configured.')
      if (!scenario?.id || !scenario?.customer?.phone) throw badRequest('Scenario id and customer phone are required.')
      const conversation = await persistence.ensureConversation({ workspaceId, provider: SIMULATOR_PROVIDER, externalContactId: scenario.customer.phone, customerName: scenario.customer.name, customerPhone: scenario.customer.phone })
      const created = await persistence.createSimulation({ workspaceId, simulation: {
        conversation_id: conversation.id,
        scenario_id: scenario.id,
        customer: scenario.customer,
        goal: scenario.goal ?? scenario.customer.goal ?? null,
        business_context: scenario.businessContext ?? {},
        success_condition: scenario.successCondition ?? null,
        max_turns: Number(scenario.maxTurns ?? 6),
        turn_count: 0,
        status: 'running',
        created_by: actor.id,
      } })
      return { simulation: created, conversation }
    },

    async nextSimulation({ request, workspaceId, simulationId, lastOpsReply = '' }) {
      const principal = await authenticate(request, authProvider)
      await authorizeWorkspace({ principal, workspaceId, membershipStore, roles: ['manager', 'operator'] })
      if (!simulator) throw badRequest('Customer simulator is not configured.')
      return simulator.next({ workspaceId, simulationId, lastOpsReply })
    },

    async ingestSimulatorMessage({ workspaceId, simulation, text, occurredAt, turn }) {
      const event = {
        id: `sim:${simulation.id}:turn:${turn}`,
        provider: SIMULATOR_PROVIDER,
        type: 'message.received',
        occurredAt,
        externalConversationId: simulation.customer?.phone,
        externalMessageId: `sim:${simulation.id}:message:${turn}`,
        sender: { id: simulation.customer?.phone ?? simulation.conversation_id, name: simulation.customer?.name },
        text,
        raw: { simulated: true, simulationId: simulation.id, turn },
        metadata: { simulated: true, simulationId: simulation.id, turn },
      }
      const stored = await persistence.recordInboundEvent({ workspaceId, actor: null, event })
      if (!stored.duplicate) await processor.process({ workspaceId, event })
      return { accepted: true, duplicate: stored.duplicate, eventId: event.id }
    },

    async ingestWebhook({ request, workspaceId, payload, provider = 'whatsapp' }) {
      if (provider === 'whatsapp') {
        const rawBody = request?.rawBody
        const signature = request?.headers?.['x-hub-signature-256'] ?? request?.headers?.get?.('x-hub-signature-256')
        if (!verifyWhatsAppSignature(rawBody, signature, whatsappAppSecret)) throw badRequest('Invalid WhatsApp webhook signature.')
      }
      const event = normalizeWebhookEvent(payload, { provider })
      let actor = null
      if (bearerToken(request)) {
        const principal = await authenticate(request, authProvider)
        actor = await authorizeWorkspace({ principal, workspaceId, membershipStore, roles: ['manager', 'operator'] })
      } else if (provider === 'whatsapp' && whatsappAppSecret && typeof resolveWebhookWorkspace === 'function') {
        workspaceId = await resolveWebhookWorkspace({ provider, event, payload })
        if (!workspaceId) throw badRequest('Webhook is not mapped to a workspace.')
      } else {
        const principal = await authenticate(request, authProvider)
        actor = await authorizeWorkspace({ principal, workspaceId, membershipStore, roles: ['manager', 'operator'] })
      }
      const stored = await persistence.recordInboundEvent({ workspaceId, actor, event })
      if (stored?.duplicate) return { accepted: true, duplicate: true, eventId: event.id }
      const queued = await outbox.enqueue({
        workspaceId,
        kind: 'process.inbound_message',
        payload: { eventId: event.id, event },
        idempotencyKey: `${workspaceId}:${event.id}`,
      })
      return { accepted: true, duplicate: false, eventId: event.id, outboxId: queued?.id }
    },

    async processInbound({ workspaceId, event, context = {} }) {
      if (!workspaceId || !event?.id) throw badRequest('workspaceId and event.id are required.')
      return processor.process({ workspaceId, event, persistence, outbox, ...context })
    },

    async ingestDeliveryWebhook({ request, payload, provider = 'whatsapp' }) {
      if (provider !== 'whatsapp' || !whatsappAppSecret) throw badRequest('Delivery webhook provider is not configured.')
      const rawBody = request?.rawBody
      const signature = request?.headers?.['x-hub-signature-256'] ?? request?.headers?.get?.('x-hub-signature-256')
      if (!verifyWhatsAppSignature(rawBody, signature, whatsappAppSecret)) throw badRequest('Invalid WhatsApp delivery signature.')
      if (!deliveryReconciler) throw new Error('Delivery reconciler is required.')
      const event = normalizeDeliveryStatus(payload, { provider })
      const workspaceId = await resolveWebhookWorkspace?.({ provider, event, payload })
      if (!workspaceId) throw badRequest('Delivery webhook is not mapped to a workspace.')
      return deliveryReconciler.reconcile(payload, { provider, workspaceId })
    },
  }
}
