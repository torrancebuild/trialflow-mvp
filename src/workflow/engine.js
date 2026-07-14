import { INTENTS, REQUIRED_FIELDS, TASK_STATES, initialTask } from './types.js'

const textOf = (messages) => messages.map((message) => message.text).join(' ').trim()

export function classifyIntent(messages) {
  const text = textOf(messages).toLowerCase()
  if (/(existing booking|current booking|my booking|booking (status|details|confirmation))/.test(text)) return { intent: INTENTS.EXISTING_BOOKING, confidence: 0.93 }
  if (/(reschedul|move|change).*(class|trial|booking)/.test(text)) return { intent: INTENTS.RESCHEDULE, confidence: 0.95 }
  if (/(what should we bring|class policy|what to bring)/.test(text)) return { intent: INTENTS.FAQ, confidence: 0.94 }
  if (/(trial|lesson|class).*(availability|available|book|weekend|weekday|near|for my|child|kids)/.test(text) || /(availability|available).*(trial|class|lesson)/.test(text)) return { intent: INTENTS.TRIAL, confidence: 0.96 }
  if (/(trial|lesson|class)/.test(text)) return { intent: INTENTS.TRIAL, confidence: 0.62 }
  return { intent: INTENTS.UNKNOWN, confidence: 0.55 }
}

export function extractFields(messages) {
  const text = textOf(messages)
  const lower = text.toLowerCase()
  const ageMatch = lower.match(/(?:age|year[- ]old|years? old)[^0-9]{0,4}(\d{1,2})|(?:\b)(\d{1,2})[- ]year[- ]old/)
  const locationMatch = text.match(/(?:near|in|at)\s+(Bedok|Tampines|Jurong|Pasir Ris)/i)
  const days = ['Saturday', 'Sunday', 'weekends', 'weekdays'].filter((day) => lower.includes(day.toLowerCase()))
  const timeMatch = text.match(/\b(\d{1,2}(?::\d{2})?\s*(?:AM|PM))\b/i)
  const childNameMatch = text.match(/(?:child(?:'s)? name is|child named)\s+([A-Z][a-z]+)/i)
  const phoneMatch = text.match(/(?:\+?65\s*)?[689]\d{3}\s*\d{4}/)
  return {
    ...(ageMatch ? { childAge: Number(ageMatch[1] || ageMatch[2]) } : {}),
    ...(locationMatch ? { location: locationMatch[1] } : {}),
    ...(days.length ? { preferredDays: days } : {}),
    ...(timeMatch ? { preferredTime: timeMatch[1].replace(/\s+/g, ' ').toUpperCase() } : {}),
    ...(!timeMatch && lower.includes('morning') ? { preferredTime: 'morning' } : {}),
    ...(!timeMatch && lower.includes('afternoon') ? { preferredTime: 'afternoon' } : {}),
    ...(childNameMatch ? { childName: childNameMatch[1] } : {}),
    ...(phoneMatch ? { contactNumber: phoneMatch[0].replace(/\s+/g, '') } : {}),
    ...(text.match(/\b(Maya|Wei|Nur|Farah|Daniel|Sam)\b/i) ? { parentName: text.match(/\b(Maya|Wei|Nur|Farah|Daniel|Sam)\b/i)[1] } : {}),
    ...(lower.includes('scared') || lower.includes('bad experience') ? { constraints: ['sensitive water confidence'] } : {}),
    trialInterest: /(trial|lesson|class)/i.test(text),
  }
}

export function getMissingFields(fields) {
  return REQUIRED_FIELDS.filter((field) => field === 'preferredDaysOrTime' ? !(fields.preferredDays?.length || fields.preferredTime) : !fields[field])
}

export function matchSlots(fields, availability) {
  const toMinutes = (time) => { const match = time?.match(/(\d{1,2})(?::(\d{2}))?\s*(AM|PM)/i); if (!match) return Number.MAX_SAFE_INTEGER; let hour = Number(match[1]) % 12; if (match[3].toLowerCase() === 'pm') hour += 12; return hour * 60 + Number(match[2] || 0) }
  return availability.filter((slot) => {
    if (slot.status !== 'available' || slot.capacityRemaining <= 0) return false
    if (fields.location && slot.location.toLowerCase() !== fields.location.toLowerCase()) return false
    if (fields.childAge && (fields.childAge < slot.ageMin || fields.childAge > slot.ageMax)) return false
    if (fields.preferredDays?.length && !fields.preferredDays.some((day) => day.toLowerCase().startsWith(slot.day.toLowerCase()) || (day === 'weekends' && ['saturday', 'sunday'].includes(slot.day.toLowerCase())))) return false
    if (fields.preferredTime && !['morning', 'afternoon'].includes(fields.preferredTime.toLowerCase()) && toMinutes(fields.preferredTime) !== toMinutes(slot.startTime)) return false
    if (fields.preferredTime?.toLowerCase() === 'morning' && toMinutes(slot.startTime) >= 12 * 60) return false
    if (fields.preferredTime?.toLowerCase() === 'afternoon' && toMinutes(slot.startTime) < 12 * 60) return false
    return true
  }).sort((a, b) => toMinutes(a.startTime) - toMinutes(b.startTime)).slice(0, 3)
}

export function decideEscalation({ intent, confidence, fields, slotsFound }) {
  if (intent === INTENTS.UNKNOWN || intent === INTENTS.RESCHEDULE || intent === INTENTS.FAQ) return 'unsupported_intent'
  if (confidence < 0.7) return 'low_confidence'
  if (fields.constraints?.length) return 'sensitive_or_personalized_request'
  if (!slotsFound) return 'no_matching_slots'
  return undefined
}

export function createDraftReply({ state, fields, slotsFound, needsHumanReason }) {
  if (state === TASK_STATES.NEEDS_HUMAN) return 'This request needs a human response before we reply. Please review the conversation and respond personally.'
  if (state === TASK_STATES.COLLECTING_INFO) {
    const labels = { childAge: 'your child’s age', location: 'your preferred location', preferredDaysOrTime: 'whether weekdays or weekends work better' }
    return `Sure, I can help. May I know ${getMissingFields(fields).map((field) => labels[field]).join(', ')}?`
  }
  if (slotsFound.length) return `Thanks! We found ${slotsFound.length} trial slot${slotsFound.length === 1 ? '' : 's'} that match your preferences. Would you like to select one?`
  return needsHumanReason ? 'A team member will review this request and get back to you.' : ''
}

export function processConversation({ taskId, conversationId, messages, availability }) {
  const task = initialTask({ id: taskId, conversationId })
  const { intent, confidence } = classifyIntent(messages)
  const fields = extractFields(messages)
  const missingFields = getMissingFields(fields)
  const preliminarySlots = missingFields.length ? [] : matchSlots(fields, availability)
  const needsHumanReason = decideEscalation({ intent, confidence, fields, slotsFound: missingFields.length ? true : preliminarySlots.length > 0 })
  const state = needsHumanReason ? TASK_STATES.NEEDS_HUMAN : missingFields.length ? TASK_STATES.COLLECTING_INFO : TASK_STATES.READY_TO_OFFER
  const reason = needsHumanReason ? `Escalated because ${needsHumanReason.replaceAll('_', ' ')}.` : missingFields.length ? `Missing ${missingFields.join(', ')} before slot matching.` : `Matched ${preliminarySlots.length} available slot${preliminarySlots.length === 1 ? '' : 's'} against the extracted preferences.`
  const events = [
    { id: `${taskId}-processed`, at: '10:24 AM', type: 'intent_classified', message: 'Intent classified and task processed' },
    ...(missingFields.length ? [{ id: `${taskId}-missing`, at: '10:24 AM', type: 'missing_fields', message: `Missing required fields: ${missingFields.join(', ')}` }] : []),
    ...(preliminarySlots.length ? [{ id: `${taskId}-slots`, at: '10:25 AM', type: 'slots_found', message: `Found ${preliminarySlots.length} matching slot${preliminarySlots.length === 1 ? '' : 's'}` }] : []),
    ...(needsHumanReason ? [{ id: `${taskId}-human`, at: '10:25 AM', type: 'human_review_requested', message: `Needs human review: ${needsHumanReason.replaceAll('_', ' ')}` }] : []),
  ]
  return { ...task, intent, state, extractedFields: fields, missingFields, suggestedSlots: preliminarySlots, draftReply: createDraftReply({ state, fields, slotsFound: preliminarySlots, needsHumanReason }), draftStatus: 'suggested', confidence, decisionReason: reason, needsHumanReason, activityLog: events }
}
