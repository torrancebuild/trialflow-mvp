import { TASK_STATES } from '../src/workflow/types.js'

const requiredFields = ['childAge', 'location', 'preferredDaysOrTime']

export const workflowUnderstandingSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['intent', 'confidence', 'extractedFields', 'draftReply'],
  properties: {
    intent: { type: 'string', enum: ['new_trial_inquiry', 'existing_booking_question', 'reschedule_request', 'faq', 'unknown'] },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    extractedFields: {
      type: 'object',
      additionalProperties: false,
      required: ['childAge', 'location', 'preferredDays', 'preferredTime'],
      properties: {
        childAge: { type: ['integer', 'null'] },
        location: { type: ['string', 'null'] },
        preferredDays: { type: 'array', items: { type: 'string' } },
        preferredTime: { type: ['string', 'null'] },
      },
    },
    draftReply: { type: 'string' },
  },
}

function missingFields(fields = {}) {
  return requiredFields.filter((field) => field === 'preferredDaysOrTime'
    ? !(fields.preferredDays?.length || fields.preferredTime)
    : fields[field] == null || fields[field] === '')
}

export function createInboundProcessor({ persistence, llm, availability }) {
  if (!persistence?.ensureConversation || !persistence?.createTask) throw new Error('Processor persistence adapter is incomplete.')
  if (!llm?.complete) throw new Error('Processor requires a structured LLM adapter.')
  if (typeof availability !== 'function') throw new Error('Processor requires an availability adapter.')

  return {
    async process({ workspaceId, event }) {
      const conversation = await persistence.ensureConversation({ workspaceId, provider: event.provider, externalContactId: event.externalConversationId })
      const existing = await persistence.getTaskForConversation?.({ workspaceId, conversationId: conversation.id })
      if (existing) {
        if (event.provider === 'simulator') {
          const messages = await persistence.getConversationMessages?.({ workspaceId, conversationId: conversation.id }) ?? []
          const understanding = await llm.complete({ messages, text: event.text, sender: event.sender }, { confidence: true })
          if (understanding.status !== 'ok') {
            const updated = await persistence.updateTask({ workspaceId, taskId: existing.id, patch: { state: TASK_STATES.NEEDS_HUMAN, needs_human_reason: 'llm_unavailable', draft_status: 'none' } })
            return { state: TASK_STATES.NEEDS_HUMAN, task: updated ?? existing }
          }
          const fields = understanding.output.extractedFields ?? understanding.output.fields ?? understanding.output
          const missing = missingFields(fields)
          const slots = missing.length ? [] : await availability({ workspaceId, fields, event })
          const state = missing.length ? TASK_STATES.COLLECTING_INFO : slots?.length ? TASK_STATES.READY_TO_OFFER : TASK_STATES.NEEDS_HUMAN
          const updated = await persistence.updateTask({ workspaceId, taskId: existing.id, patch: {
            state,
            extracted_fields: fields,
            missing_fields: missing,
            suggested_slots: slots ?? [],
            draft_reply: understanding.output.draftReply ?? understanding.output.draft_reply ?? existing.draft_reply ?? '',
            draft_status: 'suggested',
            needs_human_reason: missing.length || slots?.length ? null : 'no_matching_slots',
          } })
          await persistence.appendTaskEvent?.({ workspaceId, taskId: existing.id, eventId: `${event.id}:processed`, eventType: 'inbound_processed', payload: { state, simulated: true, model: understanding.metadata } })
          return { state, task: updated ?? existing, simulated: true, model: understanding.metadata }
        }
        // A prior attempt may have committed the task before its event/audit
        // write failed. Re-run those idempotent writes so retries repair the
        // durable record instead of silently accepting a partial result.
        await persistence.appendTaskEvent?.({ workspaceId, taskId: existing.id, eventId: `${event.id}:processed`, eventType: 'inbound_processed', payload: { state: existing.state, retry_reconciled: true } })
        await persistence.writeAudit?.({ workspaceId, action: 'inbound.retry_reconciled', entityType: 'task', entityId: existing.id, afterData: { state: existing.state } })
        return { state: existing.state, task: existing, duplicate: true, repaired: true }
      }
      const understanding = await llm.complete({ text: event.text, sender: event.sender }, { confidence: true })
      if (understanding.status !== 'ok') {
        const task = await persistence.createTask({ workspaceId, task: { conversation_id: conversation.id, state: TASK_STATES.NEEDS_HUMAN, needs_human_reason: 'llm_unavailable', extracted_fields: {}, missing_fields: requiredFields, suggested_slots: [], draft_status: 'none' } })
        await persistence.appendTaskEvent({ workspaceId, taskId: task.id, eventId: `${event.id}:needs_human`, eventType: 'needs_human', payload: { reason: 'llm_unavailable' } })
        return { state: TASK_STATES.NEEDS_HUMAN, task }
      }
      const fields = understanding.output.extractedFields ?? understanding.output.fields ?? understanding.output
      const missing = missingFields(fields)
      const slots = missing.length ? [] : await availability({ workspaceId, fields, event })
      const state = missing.length || !slots?.length ? TASK_STATES.NEEDS_HUMAN : TASK_STATES.READY_TO_OFFER
      const reason = missing.length ? 'missing_information' : !slots?.length ? 'no_matching_slots' : undefined
      const task = await persistence.createTask({ workspaceId, task: { conversation_id: conversation.id, state, extracted_fields: fields, missing_fields: missing, suggested_slots: slots ?? [], draft_reply: state === TASK_STATES.READY_TO_OFFER ? 'Available trial times are ready for review.' : 'Please review the missing information before replying.', draft_status: 'suggested', needs_human_reason: reason } })
      await persistence.appendTaskEvent({ workspaceId, taskId: task.id, eventId: `${event.id}:processed`, eventType: 'inbound_processed', payload: { state, model: understanding.metadata } })
      await persistence.writeAudit?.({ workspaceId, action: 'inbound.processed', entityType: 'task', entityId: task.id, afterData: { state, missing } })
      return { state, task, model: understanding.metadata }
    },
  }
}
