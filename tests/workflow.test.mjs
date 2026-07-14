import assert from 'node:assert/strict'
import { conversations, slots } from '../src/workflow/fixtures.js'
import { classifyIntent, extractFields, getMissingFields, matchSlots, processConversation } from '../src/workflow/engine.js'
import { reduceTask } from '../src/workflow/reducer.js'
import { TASK_STATES } from '../src/workflow/types.js'

const maya = conversations.find((item) => item.id === 'maya')
const mayaInitialMessages = maya.initialMessages
const wei = conversations.find((item) => item.id === 'wei')
const farah = conversations.find((item) => item.id === 'farah')
const empty = conversations.find((item) => item.id === 'empty')
const lowConfidence = conversations.find((item) => item.id === 'low-confidence')

assert.equal(classifyIntent(mayaInitialMessages).intent, 'new_trial_inquiry')
assert.equal(classifyIntent([{ text: 'What is my existing booking status?', direction: 'inbound' }]).intent, 'existing_booking_question')
assert.deepEqual(extractFields(mayaInitialMessages), {
  childAge: 6,
  location: 'Bedok',
  preferredDays: ['weekends'],
  trialInterest: true,
})
assert.deepEqual(getMissingFields(extractFields(wei.messages)), ['childAge', 'location'])
assert.equal(matchSlots(extractFields(mayaInitialMessages), slots).length, 2)
assert.equal(matchSlots({ childAge: 6, location: 'Bedok', preferredTime: '9:00 AM' }, slots)[0].id, 'sat')
assert.deepEqual(matchSlots({ childAge: 6, location: 'Bedok', preferredDays: ['weekends'] }, slots).map((slot) => slot.id), ['sat', 'sun'])
assert.equal(matchSlots({ childAge: 10, location: 'Bedok', preferredDays: ['weekends'] }, slots).length, 0)

const mayaTask = processConversation({ taskId: 'task-maya', conversationId: 'maya', messages: mayaInitialMessages, availability: slots })
assert.equal(mayaTask.state, TASK_STATES.READY_TO_OFFER)
assert.equal(mayaTask.suggestedSlots.length, 2)
assert.equal(mayaTask.draftStatus, 'suggested')

const missingTask = processConversation({ taskId: 'task-wei', conversationId: 'wei', messages: wei.messages, availability: slots })
assert.equal(missingTask.state, TASK_STATES.COLLECTING_INFO)
assert.equal(missingTask.suggestedSlots.length, 0)
assert.match(missingTask.draftReply, /child’s age/)

const humanTask = processConversation({ taskId: 'task-farah', conversationId: 'farah', messages: farah.messages, availability: slots })
assert.equal(humanTask.state, TASK_STATES.NEEDS_HUMAN)
assert.equal(humanTask.needsHumanReason, 'sensitive_or_personalized_request')

const noSlotsTask = processConversation({ taskId: 'task-empty', conversationId: 'empty', messages: empty.messages, availability: [] })
assert.equal(noSlotsTask.state, TASK_STATES.NEEDS_HUMAN)
assert.equal(noSlotsTask.needsHumanReason, 'no_matching_slots')

const lowConfidenceTask = processConversation({ taskId: 'task-low-confidence', conversationId: lowConfidence.id, messages: lowConfidence.messages, availability: slots })
assert.equal(lowConfidenceTask.confidence, 0.62)
assert.equal(lowConfidenceTask.state, TASK_STATES.NEEDS_HUMAN)
assert.equal(lowConfidenceTask.needsHumanReason, 'low_confidence')

let task = mayaTask
let result = reduceTask(task, { type: 'CONFIRM_BOOKING' })
assert.equal(result.error.code, 'SLOT_REQUIRED')
task = reduceTask(task, { type: 'DRAFT_SLOT_REPLY' }).task
assert.equal(task.state, TASK_STATES.AWAITING_CUSTOMER)
result = reduceTask(task, { type: 'CUSTOMER_SELECTED_SLOT', slotId: 'sat' })
task = result.task
assert.equal(task.state, TASK_STATES.READY_FOR_CONFIRMATION)
assert.equal(task.draftStatus, 'suggested')
result = reduceTask(task, { type: 'CONFIRM_BOOKING' })
assert.equal(result.error.code, 'APPROVAL_REQUIRED')
task = reduceTask(task, { type: 'APPROVE_DRAFT' }).task
task = reduceTask(task, { type: 'CONFIRM_BOOKING' }).task
assert.equal(task.state, TASK_STATES.CONFIRMED)
task = reduceTask(task, { type: 'SEND_REPLY' }).task
assert.equal(task.activityLog.at(-1).type, 'reply_sent')
assert.equal(task.sentMessages.at(-1).text, task.draftReply)
assert.equal(reduceTask(task, { type: 'SEND_REPLY' }).error.code, 'ALREADY_SENT')

assert.equal(reduceTask(task, { type: 'EDIT_DRAFT', text: 'Should be locked' }).error.code, 'CONFIRMED_TASK_LOCKED')
assert.equal(reduceTask(task, { type: 'REJECT_DRAFT' }).error.code, 'CONFIRMED_TASK_LOCKED')
assert.equal(reduceTask(task, { type: 'REQUEST_HUMAN_REVIEW' }).error.code, 'CONFIRMED_TASK_LOCKED')
assert.equal(reduceTask(task, { type: 'CUSTOMER_SELECTED_SLOT', slotId: 'unknown' }).error.code, 'INVALID_SELECTION_STATE')

const editedBeforeConfirmation = reduceTask(reduceTask(reduceTask(mayaTask, { type: 'DRAFT_SLOT_REPLY' }).task, { type: 'CUSTOMER_SELECTED_SLOT', slotId: 'sat' }).task, { type: 'EDIT_DRAFT', text: 'Edited reply' }).task
assert.equal(editedBeforeConfirmation.draftStatus, 'edited')
assert.equal(reduceTask(editedBeforeConfirmation, { type: 'APPROVE_DRAFT' }).task.draftStatus, 'approved')

const humanResult = reduceTask(humanTask, { type: 'APPROVE_DRAFT' })
assert.equal(humanResult.error.code, 'TAKEOVER_REQUIRED')
assert.equal(reduceTask(mayaTask, { type: 'TAKE_OVER' }).error.code, 'TAKEOVER_NOT_REQUIRED')
const humanOwned = reduceTask(humanTask, { type: 'TAKE_OVER' }).task
assert.equal(humanOwned.owner, 'human')
assert.equal(reduceTask(humanOwned, { type: 'APPROVE_DRAFT' }).task.draftStatus, 'approved')
assert.equal(reduceTask(humanTask, { type: 'REJECT_DRAFT' }).task.activityLog.at(-1).type, 'draft_rejected')

const processed = reduceTask(missingTask, { type: 'CUSTOMER_REPLIED', messages: mayaInitialMessages, availability: slots }).task
assert.equal(processed.state, TASK_STATES.READY_TO_OFFER)
assert.equal(reduceTask(processed, { type: 'DRAFT_SLOT_REPLY' }).task.state, TASK_STATES.AWAITING_CUSTOMER)

const editedTiming = reduceTask(missingTask, { type: 'UPDATE_FIELDS', fields: { childAge: 6, location: 'Bedok', preferredDays: ['weekends'], preferredTime: undefined }, availability: slots }).task
assert.equal(editedTiming.state, TASK_STATES.READY_TO_OFFER)
assert.deepEqual(editedTiming.suggestedSlots.map((slot) => slot.id), ['sat', 'sun'])

console.log('workflow engine and reducer tests passed')
