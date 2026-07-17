# Customer Simulator Acceptance Gates

Status: implementation in progress; authenticated release gate remains open, 16 July 2026

Current staging Preview: `https://trialflow-lcxye3rdc-torrancebuild-1850s-projects.vercel.app`

Staging evidence so far: Vercel deployment `dpl_jukeG6MspJi3XkUqftwHSycRVPL4` is
`READY`; the Vite build passed; Supabase project `djafpavrzoilgkjdfvxx` is
healthy; and the `simulations`, `conversations`, `messages`, and `tasks` tables
have RLS enabled with workspace policies. Preview-only WhatsApp boundary
variables are non-production placeholders, and simulator outbox jobs are
explicitly skipped before the WhatsApp client.

## Ownership

The simulator implementation owner is responsible for code, tests, migration safety, provider isolation, browser verification, and recording evidence. No gate is complete from code inspection alone when an external dependency is required.

## Stage gates

### Gate 1 — Contracts and safety

- [x] Simulator state is workspace-scoped.
- [x] Customer messages use a distinct `simulator` provider/channel.
- [x] Simulator outbound jobs cannot call the WhatsApp client.
- [x] Simulator routes require authenticated workspace membership.
- [x] Maximum turns and stop states are enforced.
- [x] Concurrent next-turn requests are serialized per simulation within a server process.

Evidence: `server/simulator.mjs`, `server/service.mjs`, `server/runtime.mjs`, simulator migration, unit tests. Multi-instance deployment still requires staging verification with the production deployment topology.

### Gate 2 — Multi-turn workflow

- [x] Customer-side LLM output is schema validated through the existing LLM adapter.
- [x] New simulated inbound messages are persisted idempotently.
- [x] Existing simulator tasks are reprocessed with conversation history.
- [x] Operator send can trigger the next customer turn.
- [x] A server-only OpenAI Responses provider is implemented with structured JSON output.
- [x] Real provider-backed LLM call verified in staging: authenticated Preview generated a customer turn with the configured provider/model and persisted it as a simulator inbound message.

### Gate 3 — Console flow

- [x] Authenticated console exposes start/next customer controls.
- [x] Workspace refresh reflects generated messages and task state.
- [x] Local browser flow verified with the canonical Playwright command (5/5 tests passed, including mobile navigation).
- [ ] Simulator flow verified against an authenticated staging workspace (customer generation is verified, but the latest run did not complete the slot approval/send transition cleanly).
- [x] Mobile layout verified with Playwright tab-navigation coverage.
- [x] Authenticated simulator/API error state verified in staging: approving before selecting a slot showed `Select a slot before approving the booking reply.`

### Gate 4 — Release review

- [x] Existing tests remain green.
- [x] Simulator unit tests cover generation, bounds, reprocessing, and concurrent next-turn serialization.
- [x] Migration static checks include simulator schema.
- [x] Staging verifier checks the deployed simulator relation and conversation schema before authenticated testing.
- [x] Independent backend review completed after all fixes; see `SIMULATOR_CODE_REVIEW.md`.
- [x] Independent frontend/browser review completed for the existing local console flow.
- [ ] Supabase migration, RLS, and provider-backed LLM verified in staging.

## Required final evidence

```text
 npm test                 # 41 tests passed
npm run build
git diff --check
 npm run test:e2e         # 5 tests passed
npm run verify:staging   # not run: Vercel omits the write-only service key when pulled
```

The final acceptance statement must identify any missing staging credentials, model provider configuration, browser session, or database evidence rather than treating local mocks as production proof.

`npm run verify:staging` is expected to stop with missing-credential output until `STAGING_SUPABASE_URL` and `STAGING_SUPABASE_SERVICE_ROLE_KEY` are supplied. With those variables present, it checks the REST health endpoint plus the deployed `simulations` and `conversations` relations; pgTAP remains the authoritative RLS check.

## Model configuration

Set `OPENAI_API_KEY` on the server only. Optional settings are `OPENAI_API_BASE_URL`, `SIMULATOR_LLM_MODEL`, and `SIMULATOR_LLM_PROMPT_VERSION`. The browser receives none of these values.
