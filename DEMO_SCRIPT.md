# TrialFlow Portfolio Demo Script

Target duration: 2–3 minutes.

## 1. Open the console

Start at `http://127.0.0.1:5175/` and introduce TrialFlow as an observable AI operations layer for WhatsApp-first service businesses.

## 2. Happy path — Maya Tan

1. Select Maya Tan.
2. Show the extracted age, location, weekend preference, confidence, and decision explanation.
3. Click **Offer slots** to move from ready-to-offer to awaiting customer.
4. Select the Saturday slot.
5. Show the ready-for-confirmation state.
6. Approve the draft, confirm the booking, and send the reply.
7. Point out the confirmed booking event in the activity log.

## 3. Missing information — Wei Jun

Select Wei Jun and show that the engine identifies missing child age and location, drafts a targeted follow-up, and does not show fabricated slots.

## 4. Human handoff — Farah Q.

Select Farah Q. and show the sensitive-request reason. Point out that approval and send are disabled until the operator takes ownership.

## 5. Failure handling

Show **No slots fixture** and **Sam Lee** to demonstrate no-slot and unknown-intent escalation. Use the inbox filter to show that open, all, and human-review task views are real local UI states.

## Evidence checklist

- State machine visibly advances through the happy path.
- Booking cannot be confirmed before draft approval.
- Human tasks cannot be approved or sent before takeover.
- Missing fields prevent slot matching.
- No-slot and unknown-intent cases escalate with reasons.
- Activity log records accepted workflow events.
- Unit tests and build pass before recording.
