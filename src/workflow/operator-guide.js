import { TASK_STATES } from './types.js'

export function getOperatorGuide(task) {
  if (!task) return { step: null, total: null, kicker: 'Workflow', title: 'No task selected', description: 'Select a task to see the next safe action.', action: null, tone: 'neutral' }
  if (task.state === TASK_STATES.CONFIRMED) return { step: null, total: null, kicker: 'Workflow complete', title: 'Booking confirmed', description: 'No further operator action is required for this task.', action: null, tone: 'complete' }
  if (task.state === TASK_STATES.NEEDS_HUMAN && task.owner !== 'human') return { step: null, total: null, kicker: 'Exception path', title: 'Take ownership before replying', description: 'This task needs human judgment. Take ownership to unlock editing, approval, and sending.', action: 'TAKE_OVER', actionLabel: 'Take over task', tone: 'attention' }
  if (task.state === TASK_STATES.NEEDS_HUMAN) {
    const action = task.draftStatus === 'approved' ? 'SEND_REPLY' : 'APPROVE_DRAFT'
    return { step: null, total: null, kicker: 'Human-owned task', title: action === 'SEND_REPLY' ? 'Send your approved reply' : 'Review and approve your reply', description: 'You own this exception. Edit the response if needed, then approve it before sending.', action, actionLabel: action === 'SEND_REPLY' ? 'Send reply' : 'Approve reply', tone: 'attention' }
  }
  if (task.state === TASK_STATES.COLLECTING_INFO) return { step: 1, total: 2, kicker: 'Operator sequence', title: 'Review missing information', description: `Edit the highlighted fields, then approve the follow-up reply asking for ${task.missingFields.join(', ')}.`, action: task.draftStatus === 'approved' ? null : 'APPROVE_DRAFT', actionLabel: 'Approve follow-up', tone: 'active' }
  if (task.state === TASK_STATES.READY_TO_OFFER) return { step: 1, total: 4, kicker: 'Operator sequence', title: 'Offer the matching slots', description: 'The task is ready. Send the available options to the customer before selecting or confirming anything.', action: 'DRAFT_SLOT_REPLY', actionLabel: 'Offer slots', tone: 'active' }
  if (task.state === TASK_STATES.AWAITING_CUSTOMER) return { step: 2, total: 4, kicker: 'Operator sequence', title: 'Wait for the customer to choose', description: 'No operator action is required until the customer selects one of the offered slots.', action: null, tone: 'waiting' }
  if (task.state === TASK_STATES.READY_FOR_CONFIRMATION && task.draftStatus !== 'approved') return { step: 3, total: 4, kicker: 'Operator sequence', title: 'Approve the confirmation reply', description: 'The customer selected a slot. Review the reply, edit if needed, then approve it before confirming.', action: 'APPROVE_DRAFT', actionLabel: 'Approve reply', tone: 'active' }
  if (task.state === TASK_STATES.READY_FOR_CONFIRMATION) return { step: 4, total: 4, kicker: 'Operator sequence', title: 'Confirm the booking', description: 'The slot and reply are approved. Confirm the booking to complete the task.', action: 'CONFIRM_BOOKING', actionLabel: 'Confirm booking', tone: 'active' }
  return { step: null, total: null, kicker: 'Workflow', title: 'Review this task', description: 'Review the task state and choose the highlighted next action.', action: null, tone: 'neutral' }
}
