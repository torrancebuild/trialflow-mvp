import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const migration = await readFile(new URL('../supabase/migrations/20260714000000_auth_workspace_boundary.sql', import.meta.url), 'utf8')
const hardening = await readFile(new URL('../supabase/migrations/20260714000100_workflow_hardening.sql', import.meta.url), 'utf8')
const simulator = await readFile(new URL('../supabase/migrations/20260715000000_customer_simulator.sql', import.meta.url), 'utf8')
const schema = `${migration}\n${hardening}\n${simulator}`

assert.ok(migration.trim().length > 0, 'migration must not be empty')
assert.ok(hardening.includes('create or replace function public.ingest_inbound_event'), 'hardening migration must include atomic inbound ingestion')
assert.ok(hardening.includes('create or replace function public.release_reservation'), 'hardening migration must include reservation release')
assert.match(simulator, /create table if not exists public\.simulations\b/, 'simulator migration must create simulation state')
assert.match(hardening, /create table if not exists public\.tasks\b/, 'hardening migration must create operational tables for old deployments')
assert.match(hardening, /create table if not exists public\.workflow_jobs\b/, 'hardening migration must create workflow jobs for old deployments')

for (const table of [
  'workspaces', 'workspace_members', 'profiles', 'conversations', 'provider_events', 'simulations',
  'messages', 'tasks', 'availability_slots', 'reservations', 'outbound_outbox',
  'task_events', 'audit_logs',
]) {
  assert.match(schema, new RegExp(`create table if not exists public\\.${table}\\b`), `${table} table is missing`)
}

for (const [invariant, pattern] of [
  ['RLS enablement loop', /alter table public\.%I enable row level security/],
  ['provider event uniqueness', /unique\(workspace_id,provider,provider_event_id\)/],
  ['provider message uniqueness', /unique\(workspace_id,provider,provider_message_id\)/],
  ['conversation identity uniqueness', /unique\(workspace_id,channel,external_contact_id\)/],
  ['idempotency uniqueness', /unique\(workspace_id,idempotency_key\)/],
  ['workspace conversation identity', /unique\(workspace_id,channel,external_contact_id\)/],
  ['task version column', /version bigint not null default 1/],
  ['row lock', /for update/],
  ['capacity increment', /reserved_count=reserved_count\+1/],
  ['user trigger', /for each row execute procedure public\.handle_new_user\(\)/],
  ['optimistic concurrency function', /create or replace function public\.apply_task_version/],
  ['optimistic patch function', /create or replace function public\.patch_task_version/],
  ['idempotent task patch', /patch <@ jsonb_build_object/],
  ['reservation function', /create or replace function public\.reserve_availability/],
  ['server-only reservation grant', /revoke all on function public\.reserve_availability\(uuid,uuid,text,text,timestamptz\) from public;[\s\S]*grant execute on function public\.reserve_availability\(uuid,uuid,text,text,timestamptz\) to service_role/],
  ['atomic confirmation function', /create or replace function public\.confirm_task/],
  ['confirmation slot match', /reservation slot does not match selected slot/],
  ['confirmation replay parameter binding', /confirmation_event_parameters_reused/],
  ['event reuse protection', /event_id_reused/],
  ['monotonic delivery status', /create or replace function public\.apply_delivery_status/],
  ['server-only transition grant', /grant execute on function public\.transition_task\(uuid,bigint,text,text,uuid,jsonb\) to service_role/],
  ['server-only ingestion grant', /grant execute on function public\.ingest_inbound_event\(uuid, text, text, jsonb, text, text, text, timestamptz\) to service_role/],
  ['server-only patch grant', /grant execute on function public\.patch_task_version\(uuid,bigint,jsonb\) to service_role/],
  ['server-only release grant', /grant execute on function public\.release_reservation\(uuid\) to service_role/],
  ['stale patch conflict', /stale_task_version/],
  ['event id required', /event_id_required/],
  ['simulator workspace foreign key', /foreign key \(workspace_id, conversation_id\) references public\.conversations/],
  ['simulator RLS policy', /create policy "workspace members can read simulations"/],
]) {
  assert.match(schema, pattern, `missing invariant: ${invariant}`)
}

console.log('migration static integrity checks passed')
