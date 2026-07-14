export const TASK_STATES = Object.freeze({
  NEW: 'new',
  COLLECTING_INFO: 'collecting_info',
  READY_TO_OFFER: 'ready_to_offer',
  AWAITING_CUSTOMER: 'awaiting_customer',
  READY_FOR_CONFIRMATION: 'ready_for_confirmation',
  CONFIRMED: 'confirmed',
  NEEDS_HUMAN: 'needs_human',
})

export const INTENTS = Object.freeze({
  TRIAL: 'new_trial_inquiry',
  EXISTING_BOOKING: 'existing_booking_question',
  RESCHEDULE: 'reschedule_request',
  FAQ: 'general_faq',
  UNKNOWN: 'unknown',
})

export const REQUIRED_FIELDS = ['childAge', 'location', 'preferredDaysOrTime']

export const initialTask = ({ id, conversationId }) => ({
  id,
  conversationId,
  intent: INTENTS.UNKNOWN,
  state: TASK_STATES.NEW,
  extractedFields: {},
  requiredFields: REQUIRED_FIELDS,
  missingFields: [...REQUIRED_FIELDS],
  suggestedSlots: [],
  selectedSlotId: undefined,
  draftReply: '',
  draftStatus: 'none',
  confidence: 0,
  decisionReason: '',
  needsHumanReason: undefined,
  owner: 'ai',
  sentMessages: [],
  activityLog: [],
})
