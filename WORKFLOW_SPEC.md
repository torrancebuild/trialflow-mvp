# TrialFlow Local Workflow Engine Specification

Status: implementation-ready design for the remaining MVP work.

## Goal

Turn a seeded WhatsApp-style conversation into a deterministic `BookingTask` that an operations user can inspect, edit, approve, confirm, or escalate.

This is a local demo engine. It must behave like an AI workflow without requiring a real LLM, WhatsApp API, database, authentication, or production scheduling integration.

## Scope boundary

The engine owns conversation interpretation, structured extraction, missing-field detection, slot matching, reply drafting, state transitions, approval gates, escalation, and activity logging.

The UI owns rendering, selection, editing controls, and dispatching user actions. React local state is sufficient for the MVP; reload resets the seeded demo state.

## Domain model

```ts
type Intent =
  | 'new_trial_inquiry'
  | 'existing_booking_question'
  | 'reschedule_request'
  | 'general_faq'
  | 'unknown'

type TaskState =
  | 'new'
  | 'collecting_info'
  | 'ready_to_offer'
  | 'awaiting_customer'
  | 'ready_for_confirmation'
  | 'confirmed'
  | 'needs_human'

type ExtractedFields = {
  parentName?: string
  childName?: string
  childAge?: number
  location?: string
  preferredDays?: string[]
  preferredTime?: string
  contactNumber?: string
  trialInterest?: boolean
  constraints?: string[]
}

type Slot = {
  id: string
  location: string
  day: string
  startTime: string
  endTime: string
  coach: string
  ageMin: number
  ageMax: number
  capacityRemaining: number
  status: 'available' | 'full' | 'cancelled'
}

type ActivityEvent = {
  id: string
  at: string
  type: string
  message: string
}

type Message = {
  id: string
  direction: 'inbound' | 'outbound'
  text: string
  at: string
}

type BookingTask = {
  id: string
  conversationId: string
  intent: Intent
  state: TaskState
  extractedFields: ExtractedFields
  requiredFields: string[]
  missingFields: string[]
  suggestedSlots: Slot[]
  selectedSlotId?: string
  draftReply?: string
  draftStatus: 'none' | 'suggested' | 'edited' | 'approved' | 'rejected'
  confidence: number
  decisionReason: string
  needsHumanReason?: string
  owner?: 'ai' | 'human'
  activityLog: ActivityEvent[]
}
```

## Required fields

For a new trial inquiry, require:

- `childAge`
- `location`
- At least one of `preferredDays` or `preferredTime`
- Customer confirmation of the selected slot before final booking

Parent name, child name, contact number, and constraints are optional for this MVP but should be retained when present.

## Processing pipeline

Every new or updated conversation runs through the same pure pipeline:

```text
conversation
  -> classifyIntent
  -> extractFields
  -> getMissingFields
  -> decideEscalation
  -> matchSlots
  -> chooseNextState
  -> createDraftReply
  -> appendActivityEvents
```

Each function must be deterministic and side-effect free. The first implementation may use explicit phrase/rule matching and seeded fixtures. A later LLM adapter can implement the same input/output contract without changing the UI or reducer.

### Intent classification

- Contains trial/class/lesson plus availability or booking language → `new_trial_inquiry`.
- Contains reschedule/move/change time → `reschedule_request`.
- Contains existing booking/confirmation details without a new trial request → `existing_booking_question`.
- Contains supported FAQ phrases such as what to bring or class policy → `general_faq`.
- Otherwise → `unknown`.

Confidence must be a number from `0` to `1`. Rule matches should produce `0.90–0.98`; ambiguous or unknown input should be below `0.70`.

### Field extraction

Extract from the full message history, not only the last message. Support the seeded demo phrases:

- `6-year-old` → `childAge: 6`
- `near Bedok` → `location: 'Bedok'`
- `weekends`, `Saturday`, or `Sunday` → `preferredDays`
- `Maya` / `parent` phrases → `parentName` when available

Unrecognized values remain undefined; never invent a value.

### Missing fields

Return field names in stable order: `childAge`, `location`, `preferredDaysOrTime`.

If any required field is missing, do not match slots. Draft a concise follow-up question naming only the missing information.

### Escalation rules

Set `state: 'needs_human'` when any rule matches:

- Intent is `unknown`, unsupported, or outside the trial-booking workflow.
- Confidence is below `0.70`.
- Customer expresses distress, fear, anger, or a sensitive personal situation.
- Constraints conflict or cannot be represented by the slot model.
- No available slots match the extracted fields.

When escalated, preserve extracted fields and conversation context, do not offer a fabricated slot, and provide a human-readable `needsHumanReason`.

### Slot matching

Match only slots where:

```text
status === 'available'
capacityRemaining > 0
location matches when provided
slot day matches preferredDays when provided
slot time matches preferredTime when provided
childAge is within ageMin..ageMax when provided
```

Sort results by exact location match, day preference, then start time. Return at most three slots.

## State machine

| From | Event | Guard | To |
|---|---|---|---|
| `new` | `PROCESS_CONVERSATION` | trial intent, complete fields, matching slots | `ready_to_offer` |
| `new` | `PROCESS_CONVERSATION` | trial intent, missing fields | `collecting_info` |
| `new` | `PROCESS_CONVERSATION` | escalation rule | `needs_human` |
| `collecting_info` | `DRAFT_FOLLOW_UP` | missing fields remain | `collecting_info` |
| `collecting_info` | `CUSTOMER_REPLIED` | fields now complete | `ready_to_offer` |
| `ready_to_offer` | `DRAFT_SLOT_REPLY` | matching slots exist | `awaiting_customer` |
| `awaiting_customer` | `CUSTOMER_SELECTED_SLOT` | selected slot is in suggestions | `ready_for_confirmation` |
| `ready_for_confirmation` | `APPROVE_DRAFT` | draft exists and is not rejected | `ready_for_confirmation` |
| `ready_for_confirmation` | `CONFIRM_BOOKING` | draft approved and slot selected | `confirmed` |
| `confirmed` | `SEND_REPLY` | booking is confirmed | `confirmed` |
| any non-terminal state | `REQUEST_HUMAN_REVIEW` | user explicitly escalates | `needs_human` |
| `needs_human` | `TAKE_OVER` | operator accepts ownership | `needs_human` with `owner: 'human'` |

Invalid transitions must return the unchanged task plus a structured error. In particular, `CONFIRM_BOOKING` must be rejected unless the draft is approved and a suggested slot is selected.

## Reducer contract

Implement a reducer-style function:

```ts
reduceTask(task: BookingTask, event: TaskEvent): {
  task: BookingTask
  error?: { code: string; message: string }
}
```

The reducer must:

- Be pure and deterministic.
- Append exactly one activity event for every accepted state-changing event.
- Preserve the previous task on invalid events.
- Never silently confirm or send a booking.
- Keep `needsHumanReason` when entering human review.

Recommended events:

```ts
type TaskEvent =
  | { type: 'PROCESS_CONVERSATION'; messages: Message[] }
  | { type: 'CUSTOMER_REPLIED'; messages: Message[] }
  | { type: 'DRAFT_FOLLOW_UP' }
  | { type: 'DRAFT_SLOT_REPLY' }
  | { type: 'EDIT_DRAFT'; text: string }
  | { type: 'APPROVE_DRAFT' }
  | { type: 'REJECT_DRAFT' }
  | { type: 'CUSTOMER_SELECTED_SLOT'; slotId: string }
  | { type: 'CONFIRM_BOOKING' }
  | { type: 'SEND_REPLY' }
  | { type: 'REQUEST_HUMAN_REVIEW'; reason?: string }
```

## UI contract

The console should render these engine values rather than derive scenario-specific values in the component:

- `task.state` as the visible state label and progress step.
- `task.intent` and `task.confidence` in the AI summary.
- `task.extractedFields` and `task.missingFields` in the fields panel.
- `task.suggestedSlots` in the slot panel.
- `task.draftReply` and `task.draftStatus` in the draft panel.
- `task.needsHumanReason` in the escalation panel.
- `task.activityLog` in the activity timeline.

Button rules:

- Confirm booking is disabled until a slot is selected and the draft is approved.
- Send reply is disabled until the relevant draft is approved or the task is confirmed/human-owned.
- Slot selection is disabled for `collecting_info`, `needs_human`, and `confirmed`.
- Editing a draft changes `draftStatus` to `edited` and requires re-approval.
- Rejecting a draft clears approval and leaves the task in its prior non-terminal state.

## Seeded scenarios

1. **Happy path — Maya Tan**
   - Extract age 6, Bedok, weekends.
   - Match two slots.
   - Move through ready-to-offer → awaiting-customer → ready-for-confirmation → confirmed.

2. **Missing information — Wei Jun**
   - Extract no required fields.
   - State is `collecting_info`.
   - Draft asks for age, location, and weekday/weekend preference.
   - No slots are shown.

3. **Needs human — Farah Q.**
   - Detect a sensitive/multi-child request.
   - State is `needs_human`.
   - Show the reason and preserve the conversation.

4. **No slots — synthetic test fixture**
   - Complete fields but no matching availability.
   - State is `needs_human` with reason `no_matching_slots`.

5. **Low confidence — synthetic test fixture**
   - Ambiguous message such as “Can you help with a class?”
   - State is `needs_human` with reason `low_confidence`.

## Acceptance test matrix

- Happy path reaches `confirmed` only after `APPROVE_DRAFT` and `CUSTOMER_SELECTED_SLOT`.
- A missing-info task never displays or matches slots.
- A no-slot task escalates and never offers a fabricated option.
- Low-confidence and unsupported intents escalate.
- Editing an approved draft resets approval.
- Rejecting a draft prevents confirmation.
- Selecting a slot not in `suggestedSlots` returns an error and preserves state.
- Every accepted transition appends an activity event.
- Reloading the demo restores the initial seeded state.
- Existing 10-round happy-path user test remains green after the reducer is integrated.

## Implementation order

1. Move conversations and slots into `src/workflow/fixtures.js`.
2. Add types/constants in `src/workflow/types.js`.
3. Add pure engine functions in `src/workflow/engine.js`.
4. Add reducer and event guards in `src/workflow/reducer.js`.
5. Replace component-derived scenario logic with one `task` state and `dispatch`.
6. Add engine/reducer unit tests for the acceptance matrix.
7. Add the no-slot and low-confidence fixtures to the console.
8. Re-run the browser happy path and verify the approval gate visually.

## Definition of complete

The local workflow engine is complete when all UI state is derived from a `BookingTask`, all state changes happen through `reduceTask`, invalid transitions are visible and safe, the five seeded scenarios are demonstrable, and the acceptance test matrix passes without a real external integration.
