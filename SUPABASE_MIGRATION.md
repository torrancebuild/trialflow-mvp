# Supabase Migration Handoff

The custom Vercel demo-auth layer has been removed. The local TrialFlow demo is intentionally unauthenticated and deterministic, matching `WORKFLOW_SPEC.md`. Supabase is the next application boundary; it should be introduced as an adapter around the workflow engine rather than mixed into reducer logic.

## Required sequence

1. Create a Supabase project and enable email/password Auth. The app now uses the Supabase browser client when both Vite variables are present.
2. Add only `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` to the client environment. Never expose a service-role key in Vite code.
3. Apply both timestamped migrations in order: the initial workspace/workflow boundary, followed by `20260714000100_workflow_hardening.sql` for atomic inbound ingestion, worker leasing, replay-safe reservations, and expiry/cancellation release.
4. Enable and test Row Level Security before loading real customer data.
5. Add a server/API boundary that validates the Supabase access token and enforces workspace authorization.
6. Add a feature flag for `local` versus `supabase` mode; keep local fixture mode available for demos and tests.

## Current implementation

- `src/lib/supabase.js` creates a client only when the two publishable Vite variables are configured.
- Configured deployments show a Supabase email/password sign-in screen, persist the session through `supabase-js`, and expose sign-out in the workspace profile control.
- Unconfigured local runs keep the original deterministic demo and make no Supabase network calls.
- The two migrations establish the Auth profile trigger, workspace membership boundary, workflow persistence tables, RLS, per-workspace idempotency keys, `public.apply_task_version(...)` optimistic concurrency, `public.ingest_inbound_event(...)`, replay-safe `public.reserve_availability(...)`, and `public.release_reservation(...)`. Server workers should call the RPCs through a trusted API boundary; provider secrets stay out of the browser.
- Authenticated browser deployments can set `VITE_SUPABASE_WORKSPACE_ID` to load the workspace snapshot from `/api/workspace`; task transitions and field updates are sent back through the authorized server API. Full mutation coverage and staging browser verification remain release work.

The pgTAP contract in `supabase/tests/20260714000000_auth_workspace_boundary.sql` checks the table/function surface, uniqueness guarantees, and representative RLS enablement. Run it with `supabase test db` in a linked/local Supabase project.

The server entrypoint is `api/index.js`; it requires server-only Supabase and WhatsApp configuration and exposes `/health`, `/webhooks/whatsapp`, and `/webhooks/whatsapp/delivery`. The worker entrypoint is `api/worker.js`; it requires `x-worker-token` and runs leased workflow/outbound jobs for the configured workspace. Run `npm run verify:staging` with the staging variables from `.env.example` to verify REST connectivity. This does not replace pgTAP, RLS-user tests, or concurrent reservation testing.

The repository CI workflow runs the deterministic workflow, migration-contract, API, safety, and build checks on every push and pull request. A staging Supabase project must additionally run the pgTAP contract and a disposable concurrent-reservation test before production promotion.

## Deployment configuration

Set these as Vercel Production environment variables, then redeploy:

```text
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<publishable-key>
```

In Supabase Auth, set the Site URL to the deployed TrialFlow URL and add the local URL to the redirect allow list. Create the first operator in Authentication → Users, then add their `auth.users.id` to `public.workspace_members` for the chosen workspace. Never add a service-role key to Vercel client variables.

## Acceptance criteria before Supabase is considered integrated

- Local mode boots at `/` without Supabase credentials or network calls.
- Supabase sign-in, session refresh, and sign-out work in the browser.
- An authenticated user can read only records in their workspace; workflow mutations go through the server API, which validates the user role and writes with the server-only service key.
- An unauthenticated request cannot read conversations, tasks, messages, or availability.
- A user from another workspace receives no protected rows through client queries or server APIs.
- Service-role credentials are server-only and never appear in browser bundles.
- Database migrations are reproducible from an empty project.
- Reducer transitions remain pure and are persisted atomically by an adapter/service layer.
- Duplicate event IDs cannot create duplicate messages, bookings, or activity events.
- The seeded local workflow tests remain green without Supabase.
- Browser tests cover direct local boot, Supabase auth boundary, protected API access, and sign-out.

Staging verification order:

1. Set `STAGING_SUPABASE_URL` and `STAGING_SUPABASE_SERVICE_ROLE_KEY` in the shell only.
2. Run `npm run verify:staging`.
3. Link the intended project and run `npm run test:db`.
4. Run the separate concurrent reservation test with two database connections.
5. Record the project ref, migration result, RLS result, and cleanup/rollback evidence in the release checklist.

## Cleanup verification

The repository must contain no references to the removed `TRIALFLOW_*` variables, custom `/api/auth/*` routes, HMAC session code, or demo-password login. Vercel Production should also remove those three obsolete environment variables before the first Supabase deployment.
