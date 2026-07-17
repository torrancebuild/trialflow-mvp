-- Customer-side AI simulator state. Simulator rows are workspace-scoped and
-- intentionally use a separate provider/channel so they cannot reach WhatsApp.
create table if not exists public.simulations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  conversation_id uuid not null,
  scenario_id text not null,
  customer jsonb not null default '{}'::jsonb,
  goal text,
  business_context jsonb not null default '{}'::jsonb,
  success_condition text,
  max_turns integer not null default 6 check (max_turns between 1 and 50),
  turn_count integer not null default 0 check (turn_count >= 0),
  status text not null default 'running' check (status in ('running','paused','completed','stopped')),
  last_error text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (workspace_id, conversation_id) references public.conversations(workspace_id, id) on delete cascade
);

create index if not exists simulations_workspace_status_idx
  on public.simulations(workspace_id, status, created_at desc);

alter table public.simulations enable row level security;
drop policy if exists "workspace members can read simulations" on public.simulations;
create policy "workspace members can read simulations" on public.simulations for select to authenticated
using (public.is_workspace_member(workspace_id));
