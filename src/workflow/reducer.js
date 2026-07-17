import { createDraftReply, getMissingFields, matchSlots, processConversation } from './engine.js'
import { TASK_STATES } from './types.js'

const append = (task, type, message) => ({ ...task, activityLog: [...task.activityLog, { id: `${task.id}-${task.activityLog.length + 1}`, at: '10:25 AM', type, message }] })
const failure = (task, code, message) => ({ task, error: { code, message } })

export function reduceTask(task, event) {
  switch (event.type) {
    case 'PROCESS_CONVERSATION':
    case 'CUSTOMER_REPLIED': {
      const processed = processConversation({ taskId: task.id, conversationId: task.conversationId, messages: event.messages, availability: event.availability || [] })
      return { task: { ...processed, sentMessages: task.sentMessages || [], activityLog: [...task.activityLog, ...processed.activityLog] } }
    }
    case 'DRAFT_FOLLOW_UP':
      if (task.state !== TASK_STATES.COLLECTING_INFO) return failure(task, 'INVALID_FOLLOW_UP_STATE', 'This task does not need a missing-information follow-up.')
      return { task: append(task, 'follow_up_drafted', 'Drafted a missing-information follow-up') }
    case 'DRAFT_SLOT_REPLY':
      if (task.state !== TASK_STATES.READY_TO_OFFER || !task.suggestedSlots.length) return failure(task, 'NO_SLOTS', 'Cannot draft a slot reply without matching slots.')
      return { task: append({ ...task, state: TASK_STATES.AWAITING_CUSTOMER, draftStatus: 'suggested', draftReply: createDraftReply({ state: TASK_STATES.AWAITING_CUSTOMER, fields: task.extractedFields, slotsFound: task.suggestedSlots }) }, 'draft_created', 'Drafted slot options') }
    case 'CUSTOMER_SELECTED_SLOT':
      if (task.state !== TASK_STATES.AWAITING_CUSTOMER) return failure(task, 'INVALID_SELECTION_STATE', 'Offer the matching slots before selecting one.')
      if (!task.suggestedSlots.some((slot) => slot.id === event.slotId)) return failure(task, 'INVALID_SLOT', 'Selected slot is not one of the suggested options.')
      return { task: append({ ...task, selectedSlotId: event.slotId, state: TASK_STATES.READY_FOR_CONFIRMATION, draftStatus: 'suggested', draftReply: `Great choice. Please approve this reply to confirm the ${event.slotId} trial slot.` }, 'slot_selected', 'Customer selected a matching slot') }
    case 'EDIT_DRAFT':
      if (task.state === TASK_STATES.CONFIRMED) return failure(task, 'CONFIRMED_TASK_LOCKED', 'Confirmed bookings cannot be edited.')
      return { task: append({ ...task, draftReply: event.text, draftStatus: 'edited' }, 'draft_edited', 'Operator edited the draft reply') }
    case 'UPDATE_FIELDS': {
      const fields = { ...task.extractedFields, ...event.fields }
      const missingFields = getMissingFields(fields)
      const suggestedSlots = missingFields.length ? [] : matchSlots(fields, event.availability || [])
      return { task: append({ ...task, extractedFields: fields, missingFields, suggestedSlots, selectedSlotId: undefined, state: missingFields.length ? TASK_STATES.COLLECTING_INFO : TASK_STATES.READY_TO_OFFER, draftStatus: 'suggested' }, 'fields_updated', 'Operator updated extracted information') }
    }
    case 'APPROVE_DRAFT':
      if (!task.draftReply) return failure(task, 'NO_DRAFT', 'There is no draft to approve.')
      if (task.draftStatus === 'rejected') return failure(task, 'REJECTED_DRAFT', 'Create or edit a new draft before approving.')
      if (task.state === TASK_STATES.NEEDS_HUMAN && task.owner !== 'human') return failure(task, 'TAKEOVER_REQUIRED', 'Take ownership of this task before approving a human-review reply.')
      if (![TASK_STATES.READY_TO_OFFER, TASK_STATES.READY_FOR_CONFIRMATION, TASK_STATES.COLLECTING_INFO, TASK_STATES.NEEDS_HUMAN].includes(task.state)) return failure(task, 'INVALID_APPROVAL_STATE', 'This task is not ready for draft approval.')
      return { task: append({ ...task, draftStatus: 'approved' }, 'draft_approved', 'Operations approved the draft reply') }
    case 'REJECT_DRAFT':
      if (task.state === TASK_STATES.CONFIRMED) return failure(task, 'CONFIRMED_TASK_LOCKED', 'Confirmed bookings cannot be rejected.')
      return { task: append({ ...task, draftStatus: 'rejected' }, 'draft_rejected', 'Operator rejected the draft reply') }
    case 'CONFIRM_BOOKING':
      if (!task.selectedSlotId) return failure(task, 'SLOT_REQUIRED', 'Select a suggested slot before confirming.')
      if (task.draftStatus !== 'approved') return failure(task, 'APPROVAL_REQUIRED', 'Approve the draft reply before confirming the booking.')
      if (task.state !== TASK_STATES.READY_FOR_CONFIRMATION) return failure(task, 'INVALID_CONFIRMATION_STATE', 'This task is not ready for confirmation.')
      return { task: append({ ...task, state: TASK_STATES.CONFIRMED }, 'booking_confirmed', 'Booking confirmed') }
    case 'SEND_REPLY':
      if (task.activityLog.some((event) => event.type === 'reply_sent')) return failure(task, 'ALREADY_SENT', 'This reply has already been sent.')
      if (task.state === TASK_STATES.NEEDS_HUMAN && task.owner !== 'human') return failure(task, 'TAKEOVER_REQUIRED', 'Take ownership of this task before sending a reply.')
      if (task.draftStatus !== 'approved') return failure(task, 'SEND_NOT_ALLOWED', 'Approve the current draft before sending.')
      return { task: append({ ...task, sentMessages: [...(task.sentMessages || []), { id: `${task.id}-reply-${(task.sentMessages || []).length + 1}`, direction: 'outbound', text: task.draftReply, at: '10:26 AM' }] }, 'reply_sent', 'Reply sent to customer') }
    case 'REQUEST_HUMAN_REVIEW':
      if (task.state === TASK_STATES.CONFIRMED) return failure(task, 'CONFIRMED_TASK_LOCKED', 'Confirmed bookings cannot be moved back to human review.')
      return { task: append({ ...task, state: TASK_STATES.NEEDS_HUMAN, needsHumanReason: event.reason || task.needsHumanReason || 'Operator requested human review.' }, 'human_review_requested', event.reason || 'Needs human review') }
    case 'TAKE_OVER':
      if (task.state !== TASK_STATES.NEEDS_HUMAN) return failure(task, 'TAKEOVER_NOT_REQUIRED', 'Only human-review tasks can be taken over.')
      return { task: append({ ...task, state: TASK_STATES.NEEDS_HUMAN, owner: 'human', needsHumanReason: task.needsHumanReason || 'Operator took over this task.' }, 'human_takeover', 'Operator took ownership of the task') }
    default:
      return failure(task, 'UNKNOWN_EVENT', `Unsupported task event: ${event.type}`)
  }
}
