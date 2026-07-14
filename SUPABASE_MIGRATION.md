# Supabase Migration Handoff

The custom Vercel demo-auth layer has been removed. The local TrialFlow demo is intentionally unauthenticated and deterministic, matching `WORKFLOW_SPEC.md`. Supabase is the next application boundary; it should be introduced as an adapter around the workflow engine rather than mixed into reducer logic.

## Required sequence

1. Create a Supabase project and enable email/password Auth. The app now uses the Supabase browser client when both Vite variables are present.
2. Add only `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` to the client environment. Never expose a service-role key in Vite code.
3. Add migrations for workspaces, profiles, conversations, messages, booking tasks, task events, and availability slots.
4. Enable and test Row Level Security before loading real customer data.
5. Add a server/API boundary that validates the Supabase access token and enforces workspace authorization.
6. Add a feature flag for `local` versus `supabase` mode; keep local fixture mode available for demos and tests.

## Current implementation

- `src/lib/supabase.js` creates a client only when the two publishable Vite variables are configured.
- Configured deployments show a Supabase email/password sign-in screen, persist the session through `supabase-js`, and expose sign-out in the workspace profile control.
- Unconfigured local runs keep the original deterministic demo and make no Supabase network calls.
- `supabase/migrations/20260714000000_auth_workspace_boundary.sql` establishes profiles, the first workspace membership boundary, and RLS. Conversation and task tables should reference `workspace_id` and reuse `public.is_workspace_member(...)` as they are added.

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
- An authenticated user can only read and mutate records in their workspace.
- An unauthenticated request cannot read conversations, tasks, messages, or availability.
- A user from another workspace receives no protected rows through client queries or server APIs.
- Service-role credentials are server-only and never appear in browser bundles.
- Database migrations are reproducible from an empty project.
- Reducer transitions remain pure and are persisted atomically by an adapter/service layer.
- Duplicate event IDs cannot create duplicate messages, bookings, or activity events.
- The seeded local workflow tests remain green without Supabase.
- Browser tests cover direct local boot, Supabase auth boundary, protected API access, and sign-out.

## Cleanup verification

The repository must contain no references to the removed `TRIALFLOW_*` variables, custom `/api/auth/*` routes, HMAC session code, or demo-password login. Vercel Production should also remove those three obsolete environment variables before the first Supabase deployment.
