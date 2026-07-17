const toneNames = ['purple', 'blue', 'green', 'orange']

function formatSlot(slot) {
  if (slot.date && slot.startTime) return slot
  const starts = new Date(slot.starts_at)
  const ends = new Date(slot.ends_at)
  return { ...slot, date: starts.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }), day: starts.toLocaleDateString([], { weekday: 'long' }), startTime: starts.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }), endTime: ends.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }), location: slot.location ?? 'Location pending', coach: slot.coach ?? 'Coach pending', ageMin: slot.age_min ?? 0, ageMax: slot.age_max ?? 99, capacityRemaining: Math.max(0, Number(slot.capacity ?? 0) - Number(slot.reserved_count ?? 0)), status: slot.status === 'open' ? 'available' : slot.status }
}

export function createWorkspaceView(snapshot) {
  const messagesByConversation = new Map()
  for (const message of snapshot.messages ?? []) {
    const list = messagesByConversation.get(message.conversation_id) ?? []
    list.push({ id: message.id, direction: message.direction, text: message.body, at: new Date(message.occurred_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }), timestamp: message.occurred_at })
    messagesByConversation.set(message.conversation_id, list)
  }
  const tasks = Object.fromEntries((snapshot.tasks ?? []).map((task) => [task.conversation_id, {
    ...task,
    id: task.id,
    conversationId: task.conversation_id,
    state: task.state,
    version: Number(task.version ?? 1),
    extractedFields: task.extracted_fields ?? {},
    missingFields: task.missing_fields ?? [],
    suggestedSlots: (task.suggested_slots ?? []).map(formatSlot),
    selectedSlotId: task.selected_slot_id,
    draftReply: task.draft_reply ?? '',
    draftStatus: task.draft_status ?? 'none',
    needsHumanReason: task.needs_human_reason,
    owner: task.assigned_to ? 'human' : 'ai',
    intent: task.intent ?? 'new_trial_inquiry',
    confidence: Number(task.confidence ?? 0),
    decisionReason: task.decision_reason ?? 'Loaded from the server-backed workflow.',
    sentMessages: (snapshot.outbound ?? []).filter((message) => message.task_id === task.id && !['failed', 'unknown'].includes(message.status)).map((message) => ({ id: message.id, direction: 'outbound', text: message.body, at: new Date(message.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }), timestamp: message.created_at })),
    activityLog: (snapshot.auditLogs ?? []).filter((event) => event.entity_id === task.id).map((event) => ({ id: event.id, type: event.action, at: new Date(event.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }), message: event.action })),
  }]))
  const conversations = (snapshot.conversations ?? []).map((conversation, index) => {
    const messages = messagesByConversation.get(conversation.id) ?? []
    const name = conversation.customer_name || conversation.external_contact_id || 'Unknown customer'
    return { id: conversation.id, name, customerPhone: conversation.customer_phone, channel: conversation.channel, initials: name.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase(), tone: toneNames[index % toneNames.length], time: messages.at(-1)?.at ?? '', preview: messages.at(-1)?.text ?? '', messages, initialMessages: messages }
  })
  const slots = (snapshot.availability ?? []).map(formatSlot)
  return { conversations, tasks, slots, simulations: snapshot.simulations ?? [] }
}
