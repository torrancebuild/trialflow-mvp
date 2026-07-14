# TrialFlow Production Readiness Contract

This document translates the architecture overview into a production target for a single-business pilot. The current app remains a local simulation; a box is not considered production-ready because a fixture or React state happens to represent it.

## Target flow

```text
WhatsApp webhook
  -> authenticated ingestion API
  -> normalized message + idempotency check
  -> persistent conversation/task store
  -> schema-validated understanding adapter
  -> workflow/state engine
  -> availability adapter + atomic reservation
  -> approved outbound outbox
  -> provider send + delivery webhook
  -> activity/audit log + operator console
```

## Production acceptance criteria

### Data and workflow integrity

- Duplicate inbound provider events create one message and one processing event.
- Tasks, messages, drafts, state transitions, and activity history survive restart and reload.
- State transitions are validated server-side and use optimistic concurrency or transactions.
- Confirmation rechecks availability and cannot exceed slot capacity.
- A rejected, stale, or already-sent command is idempotently refused.

### AI and bounded autonomy

- Intent and extraction outputs conform to a versioned schema.
- Invalid, timed-out, unavailable, or low-confidence model output routes to `needs_human`.
- Missing values remain missing; the system never invents customer fields or slots.
- Every model decision records confidence, model/prompt version, and decision reason.
- Human approval and task ownership are enforced on the server, not only by disabled UI buttons.

### Provider boundaries

- Webhook signatures are verified and malformed payloads are rejected.
- Availability reads distinguish “no matching slots” from provider failure.
- Outbound messages are persisted before delivery and use idempotency keys.
- Delivery states include queued, sent, delivered, failed, and unknown.
- Transient provider failures retry; permanent failures become visible human-review tasks.

### Security and operations

- Authentication and authorization protect task data and approval/send commands.
- Provider and model secrets are environment-managed and never shipped to the browser.
- Logs redact phone numbers and unnecessary message content.
- Human actions are audit logged with actor, timestamp, correlation ID, and event type.
- Health checks, migrations, backups, error monitoring, CI, staging, and rollback procedures exist.

## Current implementation status

Implemented locally: pure workflow engine, guarded reducer, seeded availability matching, deterministic reply drafting, human handoff, activity log, browser console, low-confidence fixture, and reproducible acceptance tests.

Not yet implemented: backend API, persistent database, queue/outbox, real WhatsApp provider, real LLM adapter, scheduling integration, authentication, server-side authorization, production observability, and deployment infrastructure. These require infrastructure and provider decisions; they are not represented as complete by this repository.

## Phased path

1. Put provider-neutral interfaces and a backend API around the existing pure engine.
2. Add Postgres/Supabase persistence, migrations, task versions, event records, and idempotency keys.
3. Add sandbox inbound/outbound provider adapters and an availability reservation adapter.
4. Add schema-constrained LLM output with safe fallback and configuration versioning.
5. Add authentication, authorization, redacted structured logs, metrics, health checks, CI, staging, and rollback.

The app should only be called production-ready when the criteria above pass against the deployed server-backed system.
