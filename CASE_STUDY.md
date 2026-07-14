# TrialFlow: AI Ops Agent for WhatsApp Bookings

## Problem

Small service businesses often use WhatsApp for customer conversations while schedules and operational work live elsewhere. An operations person manually translates each inquiry into a booking task, which creates delay, lost context, and missed follow-ups.

## MVP thesis

TrialFlow treats WhatsApp as the engagement channel and the booking task as the product. It makes AI behavior visible: extracted fields, confidence, workflow state, suggested next action, approvals, activity events, and human handoff.

## What the MVP demonstrates

1. A trial inquiry is classified and structured.
2. Missing fields produce a targeted follow-up draft.
3. Complete preferences are matched against local availability.
4. The operator offers slots, reviews the customer selection, edits or approves the draft, and confirms the booking.
5. Unsupported, sensitive, low-confidence, and no-slot requests escalate safely.

## Technical tradeoffs

The MVP uses a deterministic local engine instead of a live LLM or WhatsApp API. This keeps the workflow reproducible and testable while preserving an adapter boundary for future structured LLM output. React local state resets on reload; seeded fixtures stand in for message ingestion and scheduling data.

## Trust and safety decisions

- Booking confirmation requires both a selected suggested slot and an approved draft.
- Human-review tasks cannot be approved or sent until an operator takes ownership.
- Edited drafts lose approval and require re-approval.
- No-slot and ambiguous requests never receive fabricated availability.
- Every accepted workflow event creates an activity-log entry.

## Next production steps

Add a provider-backed message adapter, structured LLM adapter, persistence, authentication, real scheduling integration, and operational analytics after validating the workflow with real businesses.
