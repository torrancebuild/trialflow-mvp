-- Follow-up migration for environments that already applied the initial
-- workspace boundary. This keeps provider ingestion and worker leasing
-- database-backed and safe to retry.

create extension if not exists pgcrypto;

-- These definitions make this follow-up safe for databases that only applied
-- the original auth/workspace migration before operational tables existed.
create table if not exists public.conversations (id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade, channel text not null default 'whatsapp', external_contact_id text not null, customer_name text, customer_phone text, status text not null default 'open', last_message_at timestamptz, version bigint not null default 1, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(workspace_id,channel,external_contact_id));
create unique index if not exists conversations_workspace_id_idx on public.conversations(workspace_id,id);
create table if not exists public.messages (id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade, conversation_id uuid not null, direction text not null, provider text not null default 'whatsapp', provider_message_id text, idempotency_key text not null, body text not null, occurred_at timestamptz not null default now(), metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(), foreign key(workspace_id,conversation_id) references public.conversations(workspace_id,id) on delete cascade, unique(workspace_id,provider,provider_message_id), unique(workspace_id,idempotency_key));
create table if not exists public.tasks (id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade, conversation_id uuid not null, task_type text not null default 'booking', state text not null default 'new', version bigint not null default 1, assigned_to uuid references auth.users(id), extracted_fields jsonb not null default '{}'::jsonb, missing_fields jsonb not null default '[]'::jsonb, suggested_slots jsonb not null default '[]'::jsonb, selected_slot_id uuid, draft_reply text, draft_status text not null default 'none', needs_human_reason text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), foreign key(workspace_id,conversation_id) references public.conversations(workspace_id,id) on delete cascade, unique(workspace_id,id));
create table if not exists public.task_events (id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade, task_id uuid not null, event_id text not null, event_type text not null, actor_id uuid references auth.users(id), expected_version bigint, payload jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(), foreign key(workspace_id,task_id) references public.tasks(workspace_id,id) on delete cascade, unique(workspace_id,event_id));
create table if not exists public.availability_slots (id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade, provider text not null default 'internal', external_slot_id text, starts_at timestamptz not null, ends_at timestamptz not null, capacity integer not null, reserved_count integer not null default 0, status text not null default 'open', created_at timestamptz not null default now(), unique(workspace_id,provider,external_slot_id));
create unique index if not exists availability_slots_workspace_id_idx on public.availability_slots(workspace_id,id);
create table if not exists public.reservations (id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade, slot_id uuid not null, task_id uuid, idempotency_key text not null, customer_phone text, status text not null default 'confirmed', expires_at timestamptz, created_by uuid references auth.users(id), created_at timestamptz not null default now(), foreign key(workspace_id,slot_id) references public.availability_slots(workspace_id,id), foreign key(workspace_id,task_id) references public.tasks(workspace_id,id), unique(workspace_id,idempotency_key));
create table if not exists public.outbound_outbox (id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade, conversation_id uuid not null, task_id uuid, idempotency_key text not null, provider text not null default 'whatsapp', recipient text not null, body text not null, status text not null default 'queued', attempts integer not null default 0, available_at timestamptz not null default now(), provider_message_id text, last_error text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), foreign key(workspace_id,conversation_id) references public.conversations(workspace_id,id), foreign key(workspace_id,task_id) references public.tasks(workspace_id,id), unique(workspace_id,idempotency_key));
create table if not exists public.workflow_jobs (id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade, kind text not null, payload jsonb not null default '{}'::jsonb, idempotency_key text not null, status text not null default 'queued', attempts integer not null default 0, available_at timestamptz not null default now(), last_error text, updated_at timestamptz not null default now(), unique(workspace_id,idempotency_key));
create table if not exists public.provider_events (id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade, provider text not null, provider_event_id text not null, event_type text not null, payload jsonb not null default '{}'::jsonb, received_at timestamptz not null default now(), processed_at timestamptz, unique(workspace_id,provider,provider_event_id));
create table if not exists public.audit_logs (id bigint generated by default as identity primary key, workspace_id uuid not null references public.workspaces(id) on delete cascade, actor_id uuid references auth.users(id), action text not null, entity_type text not null, entity_id uuid, correlation_id text, before_data jsonb, after_data jsonb, created_at timestamptz not null default now());

create unique index if not exists tasks_workspace_conversation_idx on public.tasks(workspace_id, conversation_id);

create or replace function public.is_workspace_manager(target_workspace_id uuid)
returns boolean language sql stable security definer set search_path=public,pg_catalog
as $$ select exists (select 1 from public.workspace_members where workspace_id=target_workspace_id and user_id=(select auth.uid()) and role='manager'); $$;
revoke all on function public.is_workspace_manager(uuid) from public;
grant execute on function public.is_workspace_manager(uuid) to authenticated;

do $$ declare table_name text; begin
  foreach table_name in array array['conversations','messages','tasks','task_events','availability_slots','reservations','outbound_outbox','workflow_jobs','provider_events','audit_logs'] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('drop policy if exists workflow_workspace_read on public.%I', table_name);
    execute format('create policy workflow_workspace_read on public.%I for select to authenticated using (public.is_workspace_member(workspace_id))', table_name);
  end loop;
end $$;

-- Browser clients are intentionally read-only for workflow records. Mutations
-- are performed by the authenticated server API with the service role, after
-- actor/role/state checks, and are committed through the RPCs below.

create or replace function public.apply_task_version(p_expected_version bigint,p_next_state text,p_task_id uuid) returns boolean
language plpgsql security definer set search_path=public,pg_catalog
as $$
declare target_workspace_id uuid; changed_count integer; current_state text; current_draft_status text; selected_slot uuid;
begin
  select t.workspace_id,t.state,t.draft_status,t.selected_slot_id into target_workspace_id,current_state,current_draft_status,selected_slot from public.tasks t where t.id=p_task_id;
  if target_workspace_id is null or (auth.role() <> 'service_role' and not public.is_workspace_member(target_workspace_id)) then raise exception using errcode='42501',message='workspace access denied'; end if;
  if p_next_state not in ('new','collecting_info','ready_to_offer','awaiting_customer','ready_for_confirmation','confirmed','needs_human') then raise exception using errcode='22023',message='invalid task state'; end if;
  if current_state = 'confirmed' then raise exception using errcode='55000',message='confirmed task is immutable'; end if;
  if p_next_state = 'awaiting_customer' and current_state <> 'ready_to_offer' then raise exception using errcode='55000',message='invalid workflow transition'; end if;
  if p_next_state = 'ready_for_confirmation' and current_state <> 'awaiting_customer' then raise exception using errcode='55000',message='invalid workflow transition'; end if;
  if p_next_state = 'confirmed' then
    if auth.role() <> 'service_role' and not public.is_workspace_manager(target_workspace_id) then raise exception using errcode='42501',message='manager approval required'; end if;
    if current_state <> 'ready_for_confirmation' or current_draft_status <> 'approved' or selected_slot is null then raise exception using errcode='55000',message='confirmation requires approved draft and selected slot'; end if;
    if not exists (select 1 from public.reservations r where r.workspace_id=target_workspace_id and r.task_id=p_task_id and r.status in ('held','confirmed')) then raise exception using errcode='55000',message='confirmation requires reservation'; end if;
  end if;
  update public.tasks set state=p_next_state,version=version+1,updated_at=now() where id=p_task_id and version=p_expected_version;
  get diagnostics changed_count = row_count;
  return changed_count = 1;
end; $$;
revoke all on function public.apply_task_version(bigint,text,uuid) from public;
grant execute on function public.apply_task_version(bigint,text,uuid) to service_role;

create or replace function public.patch_task_version(target_task_id uuid, expected_version bigint, patch jsonb)
returns public.tasks
language plpgsql security definer set search_path=public,pg_catalog
as $$
declare task_workspace_id uuid; current_task public.tasks; updated_task public.tasks;
begin
  select * into current_task from public.tasks where id=target_task_id;
  task_workspace_id := current_task.workspace_id;
  if task_workspace_id is null then raise exception using errcode='P0002',message='task not found'; end if;
  if auth.role() <> 'service_role' and not public.is_workspace_member(task_workspace_id) then raise exception using errcode='42501',message='workspace access denied'; end if;
  if patch ? 'state' or patch ? 'version' or patch ? 'workspace_id' or patch ? 'conversation_id' then
    raise exception using errcode='22023',message='immutable task fields cannot be patched';
  end if;
  if exists (select 1 from jsonb_object_keys(patch) as key_name where key_name not in ('extracted_fields','missing_fields','suggested_slots','selected_slot_id','draft_reply','draft_status','assigned_to')) then
    raise exception using errcode='22023',message='unsupported task patch field';
  end if;
  if current_task.version <> expected_version then raise exception using errcode='40001',message='stale_task_version'; end if;
  if patch <@ jsonb_build_object('extracted_fields',current_task.extracted_fields,'missing_fields',current_task.missing_fields,'suggested_slots',current_task.suggested_slots,'selected_slot_id',current_task.selected_slot_id,'draft_reply',current_task.draft_reply,'draft_status',current_task.draft_status,'assigned_to',current_task.assigned_to) then
    return current_task;
  end if;
  update public.tasks set
    extracted_fields=case when patch ? 'extracted_fields' then coalesce(patch->'extracted_fields','{}'::jsonb) else extracted_fields end,
    missing_fields=case when patch ? 'missing_fields' then coalesce(patch->'missing_fields','[]'::jsonb) else missing_fields end,
    suggested_slots=case when patch ? 'suggested_slots' then coalesce(patch->'suggested_slots','[]'::jsonb) else suggested_slots end,
    selected_slot_id=case when patch ? 'selected_slot_id' then nullif(patch->>'selected_slot_id','')::uuid else selected_slot_id end,
    draft_reply=case when patch ? 'draft_reply' then patch->>'draft_reply' else draft_reply end,
    draft_status=case when patch ? 'draft_status' then patch->>'draft_status' else draft_status end,
    assigned_to=case when patch ? 'assigned_to' then nullif(patch->>'assigned_to','')::uuid else assigned_to end,
    version=version+1,updated_at=now()
  where id=target_task_id and version=expected_version
  returning * into updated_task;
  return updated_task;
end;
$$;
revoke all on function public.patch_task_version(uuid,bigint,jsonb) from public;
grant execute on function public.patch_task_version(uuid,bigint,jsonb) to service_role;

create unique index if not exists conversations_workspace_channel_contact_idx
  on public.conversations(workspace_id, channel, external_contact_id)
  where external_contact_id is not null;

alter table public.outbound_outbox
  add column if not exists lease_token text,
  add column if not exists lease_until timestamptz;

alter table public.workflow_jobs
  add column if not exists lease_token text,
  add column if not exists lease_until timestamptz;

create index if not exists outbox_lease_idx
  on public.outbound_outbox(status, available_at, lease_until);
create index if not exists workflow_jobs_lease_idx
  on public.workflow_jobs(status, available_at, lease_until);

create or replace function public.claim_workflow_jobs(target_workspace_id uuid, take_limit integer default 10, now_at timestamptz default now())
returns setof public.workflow_jobs
language plpgsql security definer set search_path=public,pg_catalog
as $$
begin
  if auth.role() <> 'service_role' then raise exception using errcode='42501',message='service role required'; end if;
  return query
  with selected as (
    select id from public.workflow_jobs
    where workspace_id=target_workspace_id
      and status in ('queued','failed')
      and available_at <= now_at
      and (lease_until is null or lease_until < now_at)
    order by available_at asc
    for update skip locked
    limit greatest(1, least(take_limit, 100))
  )
  update public.workflow_jobs job
  set status='processing', attempts=job.attempts+1,
      lease_token=gen_random_uuid()::text, lease_until=now_at + interval '60 seconds'
  from selected
  where job.id=selected.id
  returning job.*;
end;
$$;
revoke all on function public.claim_workflow_jobs(uuid,integer,timestamptz) from public;
grant execute on function public.claim_workflow_jobs(uuid,integer,timestamptz) to service_role;

create or replace function public.claim_outbound_messages(target_workspace_id uuid, take_limit integer default 10, now_at timestamptz default now())
returns setof public.outbound_outbox
language plpgsql security definer set search_path=public,pg_catalog
as $$
begin
  if auth.role() <> 'service_role' then raise exception using errcode='42501',message='service role required'; end if;
  return query
  with selected as (
    select id from public.outbound_outbox
    where workspace_id=target_workspace_id
      and status in ('queued','unknown')
      and available_at <= now_at
      and (lease_until is null or lease_until < now_at)
    order by available_at asc
    for update skip locked
    limit greatest(1, least(take_limit, 100))
  )
  update public.outbound_outbox message
  set status='sending', attempts=message.attempts+1,
      lease_token=gen_random_uuid()::text, lease_until=now_at + interval '60 seconds'
  from selected
  where message.id=selected.id
  returning message.*;
end;
$$;
revoke all on function public.claim_outbound_messages(uuid,integer,timestamptz) from public;
grant execute on function public.claim_outbound_messages(uuid,integer,timestamptz) to service_role;

create or replace function public.transition_task(target_task_id uuid, expected_version bigint, next_state text, p_event_id text, actor_id uuid default null, event_payload jsonb default '{}'::jsonb)
returns boolean language plpgsql security definer set search_path=public,pg_catalog
as $$
declare task_workspace_id uuid; changed boolean;
begin
  select workspace_id into task_workspace_id from public.tasks where id=target_task_id;
  if task_workspace_id is null then raise exception using errcode='P0002',message='task not found'; end if;
  if auth.role() <> 'service_role' and not public.is_workspace_member(task_workspace_id) then raise exception using errcode='42501',message='workspace access denied'; end if;
  if p_event_id is null or length(trim(p_event_id))=0 then raise exception using errcode='22023',message='event_id_required'; end if;
  if exists (select 1 from public.task_events where workspace_id=task_workspace_id and task_events.event_id=p_event_id) then
    if exists (select 1 from public.task_events where workspace_id=task_workspace_id and task_events.event_id=p_event_id and task_id<>target_task_id) then raise exception using errcode='23505',message='event_id_reused'; end if;
    return true;
  end if;
  select public.apply_task_version(expected_version,next_state,target_task_id) into changed;
  if not changed then return false; end if;
  insert into public.task_events(workspace_id,task_id,event_id,event_type,actor_id,expected_version,payload)
    values(task_workspace_id,target_task_id,p_event_id,'state.transitioned',actor_id,expected_version,coalesce(event_payload,'{}'::jsonb));
  insert into public.audit_logs(workspace_id,actor_id,action,entity_type,entity_id,correlation_id,after_data)
    values(task_workspace_id,actor_id,'task.transitioned','task',target_task_id,p_event_id,jsonb_build_object('state',next_state,'version',expected_version+1));
  return true;
end;
$$;
revoke all on function public.transition_task(uuid,bigint,text,text,uuid,jsonb) from public;
grant execute on function public.transition_task(uuid,bigint,text,text,uuid,jsonb) to service_role;

create or replace function public.ingest_inbound_event(
  target_workspace_id uuid,
  provider_name text,
  provider_event_id text,
  event_payload jsonb,
  external_conversation_id text,
  external_message_id text,
  message_body text,
  message_occurred_at timestamptz
)
returns table(duplicate boolean, conversation_id uuid, message_id uuid)
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  stored_event public.provider_events%rowtype;
  conversation public.conversations%rowtype;
  message public.messages%rowtype;
begin
  if auth.role() <> 'service_role' and not public.is_workspace_member(target_workspace_id) then
    raise exception using errcode = '42501', message = 'workspace access denied';
  end if;
  if provider_event_id is null or length(trim(provider_event_id)) = 0 then
    raise exception using errcode = '22023', message = 'provider event id is required';
  end if;

  insert into public.provider_events(workspace_id, provider, provider_event_id, event_type, payload)
  values(target_workspace_id, provider_name, provider_event_id, 'message.received', coalesce(event_payload, '{}'::jsonb))
  on conflict on constraint provider_events_workspace_id_provider_provider_event_id_key do nothing
  returning * into stored_event;

  if not found then
    select c.* into conversation
    from public.conversations c
    where c.workspace_id = target_workspace_id
      and c.channel = provider_name
      and c.external_contact_id = external_conversation_id;
    select m.* into message
    from public.messages m
    where m.workspace_id = target_workspace_id
      and m.provider = provider_name
      and m.provider_message_id = external_message_id;
    return query select true, conversation.id, message.id;
    return;
  end if;

  insert into public.conversations(workspace_id, channel, external_contact_id, last_message_at)
  values(target_workspace_id, provider_name, external_conversation_id, message_occurred_at)
  on conflict (workspace_id, channel, external_contact_id) do update
    set last_message_at = excluded.last_message_at
  returning * into conversation;

  insert into public.messages(workspace_id, conversation_id, direction, provider, provider_message_id, idempotency_key, body, occurred_at)
  values(target_workspace_id, conversation.id, 'inbound', provider_name, external_message_id,
         provider_name || ':' || external_message_id, coalesce(message_body, ''), message_occurred_at)
  on conflict (workspace_id, provider, provider_message_id) do nothing
  returning * into message;

  update public.provider_events
  set processed_at = now()
  where id = stored_event.id;
  return query select false, conversation.id, message.id;
end;
$$;

revoke all on function public.ingest_inbound_event(uuid, text, text, jsonb, text, text, text, timestamptz) from public;
grant execute on function public.ingest_inbound_event(uuid, text, text, jsonb, text, text, text, timestamptz) to service_role;

-- Recreate reservation logic with authorization before replay lookup and with
-- key-reuse protection. Capacity is released explicitly by cancellation or
-- expiry workers through release_reservation.
create or replace function public.reserve_availability(target_slot_id uuid, target_task_id uuid, reservation_key text, target_customer_phone text default null, hold_until timestamptz default null)
returns public.reservations
language plpgsql security definer set search_path=public,pg_catalog
as $$
declare slot public.availability_slots%rowtype; existing public.reservations%rowtype; created public.reservations%rowtype; task_workspace_id uuid;
begin
  select workspace_id into task_workspace_id from public.tasks where id=target_task_id;
  if task_workspace_id is null then raise exception using errcode='P0002',message='task_not_found'; end if;
  if auth.role() <> 'service_role' and not public.is_workspace_member(task_workspace_id) then raise exception using errcode='42501',message='workspace access denied'; end if;
  if reservation_key is null or length(trim(reservation_key))=0 then raise exception using errcode='22023',message='reservation_key_required'; end if;
  select * into existing from public.reservations where workspace_id=task_workspace_id and idempotency_key=reservation_key;
  if found then
    if existing.slot_id <> target_slot_id or existing.task_id is distinct from target_task_id then raise exception using errcode='23505',message='idempotency_key_reused'; end if;
    return existing;
  end if;
  select * into slot from public.availability_slots where id=target_slot_id and workspace_id=task_workspace_id for update;
  if not found or slot.status<>'open' or slot.reserved_count>=slot.capacity then raise exception using errcode='P0001',message='availability_slot_unavailable'; end if;
  insert into public.reservations(workspace_id,slot_id,task_id,idempotency_key,customer_phone,status,expires_at,created_by)
    values(task_workspace_id,target_slot_id,target_task_id,reservation_key,target_customer_phone,case when hold_until is null then 'confirmed' else 'held' end,hold_until,(select auth.uid())) returning * into created;
  update public.availability_slots set reserved_count=reserved_count+1 where id=target_slot_id;
  return created;
end;
$$;
revoke all on function public.reserve_availability(uuid,uuid,text,text,timestamptz) from public;
grant execute on function public.reserve_availability(uuid,uuid,text,text,timestamptz) to service_role;

create or replace function public.confirm_task(target_task_id uuid, expected_version bigint, target_slot_id uuid, reservation_key text, p_event_id text, acting_user_id uuid, target_customer_phone text default null)
returns table(reservation_id uuid, task_version bigint)
language plpgsql security definer set search_path=public,pg_catalog
as $$
declare task public.tasks%rowtype; reservation public.reservations%rowtype; prior_event public.task_events%rowtype;
begin
  select * into task from public.tasks where id=target_task_id for update;
  if not found then raise exception using errcode='P0002',message='task_not_found'; end if;
  if not exists (select 1 from public.workspace_members where workspace_id=task.workspace_id and user_id=acting_user_id and role='manager') then
    raise exception using errcode='42501',message='manager approval required';
  end if;
  if p_event_id is null or length(trim(p_event_id))=0 then raise exception using errcode='22023',message='event_id_required'; end if;
  if p_event_id is not null then
    select * into prior_event from public.task_events where workspace_id=task.workspace_id and event_id=p_event_id;
    if found then
      if prior_event.task_id <> target_task_id then raise exception using errcode='23505',message='event_id_reused'; end if;
      if prior_event.expected_version is distinct from expected_version
        or prior_event.payload->>'reservation_key' is distinct from reservation_key
        or prior_event.payload->>'slot_id' is distinct from target_slot_id::text then
        raise exception using errcode='23505',message='confirmation_event_parameters_reused';
      end if;
      select * into reservation from public.reservations where task_id=target_task_id and idempotency_key=reservation_key;
      if not found then raise exception using errcode='55000',message='confirmation event has no reservation'; end if;
      return query select reservation.id, task.version;
      return;
    end if;
  end if;
  if task.version <> expected_version then raise exception using errcode='40001',message='stale_task_version'; end if;
  if task.state <> 'ready_for_confirmation' or task.draft_status <> 'approved' then raise exception using errcode='55000',message='confirmation requires approved draft'; end if;
  if task.selected_slot_id is distinct from target_slot_id then raise exception using errcode='55000',message='reservation slot does not match selected slot'; end if;
  reservation := public.reserve_availability(target_slot_id,target_task_id,reservation_key,target_customer_phone,null);
  update public.tasks set state='confirmed',version=version+1,selected_slot_id=target_slot_id,updated_at=now() where id=target_task_id and version=expected_version;
  if not found then raise exception using errcode='40001',message='stale_task_version'; end if;
  insert into public.task_events(workspace_id,task_id,event_id,event_type,actor_id,expected_version,payload)
    values(task.workspace_id,target_task_id,p_event_id,'booking.confirmed',acting_user_id,expected_version,jsonb_build_object('reservation_id',reservation.id,'reservation_key',reservation_key,'slot_id',target_slot_id));
  insert into public.audit_logs(workspace_id,actor_id,action,entity_type,entity_id,correlation_id,after_data)
    values(task.workspace_id,acting_user_id,'booking.confirmed','task',target_task_id,p_event_id,jsonb_build_object('reservation_id',reservation.id,'version',expected_version+1));
  return query select reservation.id, expected_version+1;
end;
$$;
revoke all on function public.confirm_task(uuid,bigint,uuid,text,text,uuid,text) from public;
grant execute on function public.confirm_task(uuid,bigint,uuid,text,text,uuid,text) to service_role;

create or replace function public.release_reservation(target_reservation_id uuid)
returns boolean language plpgsql security definer set search_path=public,pg_catalog
as $$
declare reservation public.reservations%rowtype; changed boolean;
begin
  select * into reservation from public.reservations where id=target_reservation_id for update;
  if not found or (auth.role() <> 'service_role' and not public.is_workspace_member(reservation.workspace_id)) then return false; end if;
  if reservation.status in ('cancelled','expired') then return false; end if;
  update public.reservations set status=case when expires_at is not null and expires_at <= now() then 'expired' else 'cancelled' end where id=target_reservation_id;
  update public.availability_slots set reserved_count=greatest(0,reserved_count-1), status=case when status='closed' then status else 'open' end where id=reservation.slot_id;
  get diagnostics changed=row_count;
  return changed;
end;
$$;

revoke all on function public.release_reservation(uuid) from public;
grant execute on function public.release_reservation(uuid) to service_role;

create or replace function public.apply_delivery_status(target_workspace_id uuid, external_message_id text, next_status text, error_payload jsonb default null)
returns public.outbound_outbox
language plpgsql security definer set search_path=public,pg_catalog
as $$
declare updated_message public.outbound_outbox;
begin
  if auth.role() <> 'service_role' then raise exception using errcode='42501',message='service role required'; end if;
  if next_status not in ('sent','delivered','read','failed','unknown') then raise exception using errcode='22023',message='invalid delivery status'; end if;
  update public.outbound_outbox set status=case when
    case next_status when 'unknown' then 1 when 'sent' then 2 when 'failed' then 3 when 'delivered' then 4 when 'read' then 5 end >=
    case status when 'unknown' then 1 when 'sent' then 2 when 'failed' then 3 when 'delivered' then 4 when 'read' then 5 else 0 end
    then next_status else status end,
    last_error=case when error_payload is null then last_error else error_payload->>'message' end,
    lease_token=null,lease_until=null,updated_at=now()
  where workspace_id=target_workspace_id and provider_message_id=external_message_id
  returning * into updated_message;
  return updated_message;
end;
$$;
revoke all on function public.apply_delivery_status(uuid,text,text,jsonb) from public;
grant execute on function public.apply_delivery_status(uuid,text,text,jsonb) to service_role;
