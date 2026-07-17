# MessageOps End-to-End Implementation Plan

Status: planning baseline, 15 July 2026

## Execution status

- [x] P0.1 local deployable API boundary: Vercel entrypoint, runtime assembly, server configuration validation, route protection, request-size limit, and local tests.
- [x] P0.2 staging verification scaffolding: server-only environment template, REST health check, pgTAP command, and documented staging sequence.
- [~] P0.3 authenticated UI/server slice: workspace snapshot loading and explicit server task commands are implemented, including optimistic patching, manager-gated atomic reservation/confirmation, takeover, reload recovery, and idempotent outbound queueing; real Supabase execution and authenticated browser tests remain.
- [ ] P0 staging execution and release evidence: blocked until a Supabase staging project, credentials, linked CLI, and test workspace are available.

Current verification evidence: `npm test` (28 tests passed), `npm run build` passed, `git diff --check` passed, and the in-app browser smoke flow passed through offer → select → approve → confirm → send with no browser console errors. The in-app browser was used because the repository Playwright web server could not bind reliably in the sandbox. Live Supabase/RLS/pgTAP/concurrency and authenticated browser verification remain unproven until staging infrastructure is supplied.

Final local review evidence: independent frontend and backend reviewers re-checked the previously reported local P0 findings after fixes. They found no remaining local defects. The final gate remains conditional on the external staging and authenticated-browser evidence listed below.

## Mandatory final review gate

Review agents must independently audit the repository against this plan before release is described as complete. They may not approve based only on unit tests or documentation.

Hard acceptance criteria:

- Every P0.1, P0.2, and P0.3 work item has direct evidence in code, tests, or a staging run; missing evidence is a finding, not an assumption of completion.
- No browser-facing path can use a service-role key, bypass workspace authorization, mutate immutable task fields, or confirm without manager authorization, reservation, approved draft, selected slot, and optimistic-version success.
- Inbound events, task transitions, task patches, reservations, outbound jobs, and delivery updates are replay-safe and have tests for duplicates, stale versions, failures, and retries.
- Local mode and authenticated server-backed mode are both covered by a repeatable browser flow; authenticated mode must be tested against a real staging project when credentials are available.
- Migration checks include empty-database reproducibility, RLS isolation, pgTAP, and concurrent capacity enforcement; otherwise the review must report the exact external blocker.
- `npm test`, `npm run build`, `git diff --check`, and the applicable browser/staging checks pass at the final review point.
- Any finding marked incomplete must be fixed and re-reviewed, or recorded as an external blocker with the evidence needed to unblock it.

This plan closes the remaining production gaps in dependency order. Each phase is complete only when its implementation, review, tests, and deployment evidence are recorded. The local deterministic demo remains available throughout.

## Operating loop

For every phase:

1. Confirm the scope and acceptance criteria before editing code.
2. Implement the smallest vertical slice that satisfies the criteria.
3. Add or update deterministic tests, including failure and retry cases.
4. Run `npm test`, `npm run build`, and the phase-specific checks.
5. Perform a focused code review for authorization, idempotency, secrets, failure handling, and observability.
6. Run the slice against staging where external services or Postgres behavior are involved.
7. Record evidence, unresolved risks, and a rollback step before moving on.

Do not mark a phase complete because mocks pass. A phase involving an external system needs a real staging verification or an explicitly documented blocker.

## Priority order

### P0 — Establish the deployable server boundary

Goal: make the existing API modules callable in the target hosting environment.

Work:

- Add the concrete serverless/edge entrypoint and route wiring for health, inbound WhatsApp webhooks, and delivery webhooks.
- Wire `createApiService`, Supabase persistence, processor, outbox workers, and health checks into one runtime factory.
- Define environment validation for Supabase server URL/service key, WhatsApp secrets, webhook mapping, and runtime version.
- Add request-size limits, webhook replay handling, structured error responses, and safe startup failure behavior.

Exit criteria:

- A staging deployment answers `/health` and rejects malformed or unsigned webhooks.
- Service-role credentials are server-only and absent from the browser bundle.
- A code review confirms every mutation path has authentication, workspace authorization, or a provider-signature boundary.
- Deployment, environment setup, and rollback instructions are documented.

### P0 — Provision and validate the Supabase staging boundary

Goal: prove that persistence and isolation work on a real database.

Work:

- Create or select a disposable staging Supabase project.
- Apply both migrations from an empty database.
- Create test users, workspaces, memberships, and representative workflow data.
- Run the pgTAP contract and add a real concurrent-reservation test using separate connections.
- Verify RLS for same-workspace reads, cross-workspace reads, unauthenticated reads, operator actions, and manager-only confirmation.
- Verify idempotency for inbound events, task events, outbox jobs, reservations, and delivery updates.

Exit criteria:

- Migrations are reproducible from empty state.
- RLS and role checks pass against staging data.
- Concurrent reservation never exceeds capacity.
- A rollback or forward-fix procedure is tested on the disposable project.

### P0 — Connect the UI to the server-backed workflow

Goal: replace the browser’s seeded operational state for authenticated deployments.

Work:

- Add a local-versus-Supabase mode boundary.
- Load workspace conversations, messages, tasks, availability, and activity from the API/database.
- Route field edits, human takeover, draft approval, slot selection, confirmation, and review actions through authenticated API mutations.
- Preserve the current local fixture mode for demos and unit tests.
- Add loading, empty, stale-version, permission, and server-error states.

Exit criteria:

- Reloading the browser preserves the server-backed task state.
- A second user cannot read or mutate another workspace.
- Confirmed bookings require server-side manager approval, an approved draft, a selected slot, and a reservation.
- Browser tests cover local boot, authenticated boot, protected access, sign-out, mutation failures, and reload persistence.

### P1 — Complete live WhatsApp ingestion and delivery

Goal: validate the complete inbound-to-outbound channel boundary.

Work:

- Configure Meta test business, phone number, app secret, access token, webhook URL, and verification challenge.
- Map provider phone/account identifiers to workspaces server-side.
- Test inbound text normalization, duplicate delivery, malformed payloads, signature failures, and provider retries.
- Run outbound queue workers with lease recovery and retry/backoff behavior.
- Reconcile sent, delivered, read, failed, and unknown statuses idempotently.
- Confirm permanent failures create a visible human-review state.

Exit criteria:

- One real sandbox message produces one durable conversation/message/task.
- One approved reply is sent once even after retries.
- Delivery status updates are visible and auditable.
- Provider credentials and logs pass the secret/PII review.

### P1 — Integrate real scheduling availability and reservations

Goal: replace seeded availability with a provider-backed, capacity-safe source.

Work:

- Select the scheduling provider and define the adapter contract for reads, holds, confirmations, cancellations, and expiry.
- Implement availability reads with explicit `no_match` versus `provider_unavailable` outcomes.
- Recheck availability immediately before confirmation.
- Connect holds/reservations to the database RPCs and provider operation IDs.
- Add expiry, cancellation, retry, reconciliation, and manual recovery paths.

Exit criteria:

- A real staging slot can be read, held, confirmed, cancelled, and recovered after a worker failure.
- Capacity remains correct under concurrent confirmation attempts.
- Provider failure never appears as “no slots.”

### P1 — Connect the production LLM adapter safely

Goal: enable bounded automation without weakening human fallback.

Work:

- Choose the model provider and server-only credential configuration.
- Define and version the extraction/intent schema and prompt configuration.
- Add confidence thresholds, timeout budgets, token/cost limits, and provider error classification.
- Persist model version, prompt version, confidence, decision reason, and fallback reason.
- Add adversarial fixtures for ambiguity, missing fields, malformed output, prompt injection, and unsupported requests.

Exit criteria:

- Invalid, uncertain, timed-out, or unavailable model output routes to `needs_human`.
- The model cannot invent slots or customer fields.
- Production logs contain decision metadata without raw PII.
- A human can inspect and take over every fallback task.

### P2 — Production operations, resilience, and release readiness

Goal: make the system operable and recoverable.

Work:

- Deploy health checks, metrics, error monitoring, alerts, dashboards, and correlation IDs.
- Configure database backups, retention, restore testing, and secret rotation.
- Document migration ordering, rollback/forward-fix strategy, incident response, and provider outage handling.
- Add rate limits, abuse protection, dependency timeouts, dead-letter/replay tooling, and worker lease recovery checks.
- Run a staging soak test and a rollback rehearsal.

Exit criteria:

- An operator can detect a failed dependency, identify affected tasks, replay safe work, and recover without data duplication.
- Restore and rollback procedures have recent evidence.
- Release checklist is signed off for security, data integrity, privacy, operations, and UX.

## Review gates

Every pull request must include:

- Scope and phase identifier.
- Tests added or updated and their output.
- Security review: auth boundary, workspace scope, secret handling, PII exposure.
- Reliability review: idempotency, retries, leases, concurrency, partial failure recovery.
- Migration impact and rollback/forward-fix notes when database changes are included.
- Screenshots or browser evidence for UI changes.

The implementation owner should request review at each P0/P1 gate, after the vertical slice is working but before staging promotion. Review findings are fixed and re-tested in the same phase; deferred findings must be recorded with an owner and due phase.

## Definition of done

The system is ready for a pilot only when all P0 and P1 exit criteria pass in staging, P2 operational controls are in place, and the complete path works:

`WhatsApp webhook → authenticated/idempotent ingestion → persisted task → bounded understanding → real availability → atomic reservation → approved outbox send → delivery reconciliation → audited operator console`

Until then, describe the product as a production foundation or staging pilot, not production-ready.

## First session tomorrow

Start with P0 deployable server boundary. Before coding, inspect the hosting target and current API exports, then add the smallest health endpoint and webhook entrypoint. End that session with a local integration test, a build, and a concrete staging deployment checklist. Do not begin provider or LLM configuration until the server boundary and Supabase staging project are ready.
