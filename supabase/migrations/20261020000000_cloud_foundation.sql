-- LeadLoop Phase 3A.1 cloud foundation, hardened before first deployment.
-- Applies no customer data by itself. Run only against a reviewed Supabase project.
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
-- Import RPCs run with search_path=public, so expose only the required hash primitive.
grant usage on schema extensions to authenticated;
grant execute on function extensions.digest(bytea, text) to authenticated;

create type public.workspace_role as enum ('owner', 'member');
create type public.quote_status as enum ('draft', 'sent', 'accepted', 'declined');
create type public.import_state as enum ('prepared', 'completed', 'rolled_back');

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 1 and 160),
  owner_user_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.workspace_role not null default 'member', created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
create or replace function public.is_workspace_member(target_workspace uuid) returns boolean language sql stable security definer set search_path=public as $$ select exists (select 1 from public.workspace_members where workspace_id=target_workspace and user_id=auth.uid()) $$;
create or replace function public.is_workspace_owner(target_workspace uuid) returns boolean language sql stable security definer set search_path=public as $$ select exists (select 1 from public.workspace_members where workspace_id=target_workspace and user_id=auth.uid() and role='owner') $$;
revoke all on function public.is_workspace_member(uuid), public.is_workspace_owner(uuid) from public;
grant execute on function public.is_workspace_member(uuid), public.is_workspace_owner(uuid) to authenticated;

create table public.workspace_preferences (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  timezone text not null check (char_length(timezone) between 1 and 100),
  working_days smallint[] not null default array[1,2,3,4,5]::smallint[] check (working_days <@ array[0,1,2,3,4,5,6]::smallint[]),
  updated_at timestamptz not null default now()
);
create table public.customers (
  id text not null check (char_length(id) between 1 and 160), workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 160), business text not null default '', email text not null default '', phone text not null default '', address text not null default '', notes text not null default '',
  created_at timestamptz not null, updated_at timestamptz not null, primary key (workspace_id,id)
);
create index customers_workspace_name_idx on public.customers(workspace_id, lower(name));
create table public.customer_interactions (
  id text not null check (char_length(id) between 1 and 160), workspace_id uuid not null references public.workspaces(id) on delete cascade, customer_id text not null,
  note text not null check (char_length(note)<=10000), created_at timestamptz not null, primary key(workspace_id,id),
  foreign key(workspace_id,customer_id) references public.customers(workspace_id,id) on delete cascade
);
create table public.quotes (
  id text not null check (char_length(id) between 1 and 160), workspace_id uuid not null references public.workspaces(id) on delete cascade, customer_id text not null,
  service_description text not null check(char_length(trim(service_description)) between 1 and 240), amount_cents integer not null check(amount_cents>0 and amount_cents<=100000000), currency text not null default 'USD' check(currency='USD'), status public.quote_status not null default 'draft', notes text not null default '',
  created_at timestamptz not null, updated_at timestamptz not null, primary key(workspace_id,id),
  foreign key(workspace_id,customer_id) references public.customers(workspace_id,id) on delete restrict
);
create table public.quote_status_history (
  id text not null check(char_length(id) between 1 and 160), workspace_id uuid not null references public.workspaces(id) on delete cascade, quote_id text not null,
  from_status public.quote_status, to_status public.quote_status not null, changed_at timestamptz not null, primary key(workspace_id,id),
  foreign key(workspace_id,quote_id) references public.quotes(workspace_id,id) on delete cascade
);
create table public.tasks (
  id text not null check(char_length(id) between 1 and 160), workspace_id uuid not null references public.workspaces(id) on delete cascade,
  title text not null check(char_length(trim(title)) between 1 and 240), person text not null default '', person_id text, quote_id text,
  due timestamptz, completed boolean not null default false, notes text not null default '', created_at timestamptz not null default now(), updated_at timestamptz not null default now(), primary key(workspace_id,id),
  foreign key(workspace_id,person_id) references public.customers(workspace_id,id) on delete set null (person_id),
  foreign key(workspace_id,quote_id) references public.quotes(workspace_id,id) on delete set null (quote_id)
);
create index tasks_workspace_due_idx on public.tasks(workspace_id,due) where not completed;
create table public.device_notification_tokens (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade, user_id uuid not null references auth.users(id) on delete cascade,
  token text not null, platform text not null check(platform in ('ios','android','web')), created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(workspace_id,user_id,token)
);
create table public.local_imports (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade, initiated_by uuid not null references auth.users(id) on delete restrict,
  source_digest text not null check(source_digest ~ '^sha256:[a-f0-9]{64}$'), state public.import_state not null default 'prepared', expected_counts jsonb not null default '{}'::jsonb, database_counts jsonb,
  rollback_reason text, prepared_at timestamptz not null default now(), completed_at timestamptz, rolled_back_at timestamptz, attempt_count integer not null default 0 check(attempt_count>=0), last_attempt_at timestamptz,
  unique(workspace_id,source_digest)
);

alter table public.workspaces enable row level security; alter table public.workspace_members enable row level security; alter table public.workspace_preferences enable row level security; alter table public.customers enable row level security; alter table public.customer_interactions enable row level security; alter table public.quotes enable row level security; alter table public.quote_status_history enable row level security; alter table public.tasks enable row level security; alter table public.device_notification_tokens enable row level security; alter table public.local_imports enable row level security;
create policy workspace_select on public.workspaces for select to authenticated using(public.is_workspace_member(id));
create policy workspace_update on public.workspaces for update to authenticated using(public.is_workspace_owner(id)) with check(public.is_workspace_owner(id));
create policy member_select on public.workspace_members for select to authenticated using(public.is_workspace_member(workspace_id));
create policy member_manage on public.workspace_members for all to authenticated using(public.is_workspace_owner(workspace_id)) with check(public.is_workspace_owner(workspace_id));
create policy preferences_access on public.workspace_preferences for all to authenticated using(public.is_workspace_member(workspace_id)) with check(public.is_workspace_member(workspace_id));
create policy customers_access on public.customers for all to authenticated using(public.is_workspace_member(workspace_id)) with check(public.is_workspace_member(workspace_id));
create policy interactions_access on public.customer_interactions for all to authenticated using(public.is_workspace_member(workspace_id)) with check(public.is_workspace_member(workspace_id));
create policy quotes_access on public.quotes for all to authenticated using(public.is_workspace_member(workspace_id)) with check(public.is_workspace_member(workspace_id));
create policy quote_history_access on public.quote_status_history for all to authenticated using(public.is_workspace_member(workspace_id)) with check(public.is_workspace_member(workspace_id));
create policy tasks_access on public.tasks for all to authenticated using(public.is_workspace_member(workspace_id)) with check(public.is_workspace_member(workspace_id));
create policy device_token_access on public.device_notification_tokens for select to authenticated using(user_id=auth.uid() and public.is_workspace_member(workspace_id));
create policy device_token_write on public.device_notification_tokens for all to authenticated using(user_id=auth.uid() and public.is_workspace_member(workspace_id)) with check(user_id=auth.uid() and public.is_workspace_member(workspace_id));
-- Import metadata is intentionally owner-only, even for read access.
create policy imports_owner_access on public.local_imports for all to authenticated using(public.is_workspace_owner(workspace_id)) with check(public.is_workspace_owner(workspace_id));

create or replace function public.create_workspace(workspace_name text) returns public.workspaces language plpgsql security definer set search_path=public as $$
declare created public.workspaces; begin
  if auth.uid() is null then raise exception 'Authentication is required'; end if;
  insert into public.workspaces(name,owner_user_id) values(workspace_name,auth.uid()) returning * into created;
  insert into public.workspace_members(workspace_id,user_id,role) values(created.id,auth.uid(),'owner');
  insert into public.workspace_preferences(workspace_id,timezone) values(created.id,'America/Chicago'); return created;
end $$;
grant execute on function public.create_workspace(text) to authenticated;

create or replace function public.local_import_conflicts(p_workspace_id uuid,p_snapshot jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb; begin
  if not public.is_workspace_owner(p_workspace_id) then raise exception 'Workspace owner access required'; end if;
  select jsonb_build_object(
    'customers',coalesce((select jsonb_agg(x->>'id') from jsonb_array_elements(coalesce(p_snapshot->'people','[]')) x join public.customers r on r.workspace_id=p_workspace_id and r.id=x->>'id'),'[]'::jsonb),
    'interactions',coalesce((select jsonb_agg(i->>'id') from jsonb_array_elements(coalesce(p_snapshot->'people','[]')) p cross join lateral jsonb_array_elements(coalesce(p->'interactions','[]')) i join public.customer_interactions r on r.workspace_id=p_workspace_id and r.id=i->>'id'),'[]'::jsonb),
    'quotes',coalesce((select jsonb_agg(x->>'id') from jsonb_array_elements(coalesce(p_snapshot->'quotes','[]')) x join public.quotes r on r.workspace_id=p_workspace_id and r.id=x->>'id'),'[]'::jsonb),
    'quoteStatusChanges',coalesce((select jsonb_agg(h->>'id') from jsonb_array_elements(coalesce(p_snapshot->'quotes','[]')) q cross join lateral jsonb_array_elements(coalesce(q->'statusHistory','[]')) h join public.quote_status_history r on r.workspace_id=p_workspace_id and r.id=h->>'id'),'[]'::jsonb),
    'tasks',coalesce((select jsonb_agg(x->>'id') from jsonb_array_elements(coalesce(p_snapshot->'tasks','[]')) x join public.tasks r on r.workspace_id=p_workspace_id and r.id=x->>'id'),'[]'::jsonb)) into result;
  return result;
end $$;
grant execute on function public.local_import_conflicts(uuid,jsonb) to authenticated;

create or replace function public.prepare_local_import(p_workspace_id uuid,p_source_digest text,p_snapshot_json text) returns jsonb language plpgsql security invoker set search_path=public as $$
declare snapshot jsonb; existing public.local_imports; conflicts jsonb; counts jsonb; begin
  if not public.is_workspace_owner(p_workspace_id) then raise exception 'Workspace owner access required'; end if;
  if p_source_digest !~ '^sha256:[a-f0-9]{64}$' or p_source_digest <> ('sha256:' || encode(extensions.digest(convert_to(p_snapshot_json,'UTF8'),'sha256'::text),'hex')) then raise exception 'Snapshot digest does not match supplied JSON'; end if;
  -- An identical, verified snapshot is idempotent. It must win before ID
  -- conflict detection, because its records are already present by design.
  select * into existing from public.local_imports where workspace_id=p_workspace_id and source_digest=p_source_digest;
  if found and existing.state='completed' then return jsonb_build_object('import_id',existing.id,'duplicate',true,'ready',true,'conflicts',jsonb_build_object('customers','[]'::jsonb,'interactions','[]'::jsonb,'quotes','[]'::jsonb,'quoteStatusChanges','[]'::jsonb,'tasks','[]'::jsonb),'counts',existing.database_counts); end if;
  snapshot:=p_snapshot_json::jsonb; conflicts:=public.local_import_conflicts(p_workspace_id,snapshot);
  if conflicts <> '{"customers":[],"interactions":[],"quotes":[],"quoteStatusChanges":[],"tasks":[]}'::jsonb then return jsonb_build_object('import_id',null,'duplicate',false,'ready',false,'conflicts',conflicts); end if;
  counts:=jsonb_build_object('customers',jsonb_array_length(coalesce(snapshot->'people','[]')),'interactions',coalesce((select sum(jsonb_array_length(coalesce(x->'interactions','[]'))) from jsonb_array_elements(coalesce(snapshot->'people','[]')) x),0),'quotes',jsonb_array_length(coalesce(snapshot->'quotes','[]')),'quoteStatusChanges',coalesce((select sum(jsonb_array_length(coalesce(x->'statusHistory','[]'))) from jsonb_array_elements(coalesce(snapshot->'quotes','[]')) x),0),'tasks',jsonb_array_length(coalesce(snapshot->'tasks','[]')));
  insert into public.local_imports(workspace_id,initiated_by,source_digest,state,expected_counts) values(p_workspace_id,auth.uid(),p_source_digest,'prepared',counts) on conflict(workspace_id,source_digest) do update set state='prepared',expected_counts=excluded.expected_counts,rollback_reason=null,prepared_at=now(),rolled_back_at=null where public.local_imports.state='rolled_back' returning * into existing;
  if existing.id is null then select * into existing from public.local_imports where workspace_id=p_workspace_id and source_digest=p_source_digest; end if;
  return jsonb_build_object('import_id',existing.id,'duplicate',false,'ready',true,'conflicts',conflicts);
end $$;
grant execute on function public.prepare_local_import(uuid,text,text) to authenticated;

create or replace function public.import_local_workspace(p_workspace_id uuid,p_import_id uuid,p_source_digest text,p_snapshot_json text) returns jsonb language plpgsql security invoker set search_path=public as $$
declare snapshot jsonb; item public.local_imports; conflicts jsonb; actual jsonb; begin
  if not public.is_workspace_owner(p_workspace_id) then raise exception 'Workspace owner access required'; end if;
  if p_source_digest <> ('sha256:' || encode(extensions.digest(convert_to(p_snapshot_json,'UTF8'),'sha256'::text),'hex')) then raise exception 'Snapshot digest does not match supplied JSON'; end if;
  snapshot:=p_snapshot_json::jsonb; perform pg_advisory_xact_lock(hashtext(p_workspace_id::text));
  select * into item from public.local_imports where id=p_import_id and workspace_id=p_workspace_id and source_digest=p_source_digest for update;
  if not found then raise exception 'Prepared import was not found'; end if;
  if item.state='completed' then return jsonb_build_object('import_id',item.id,'duplicate',true,'counts',item.database_counts); end if;
  if item.state<>'prepared' then raise exception 'Import is not prepared for retry'; end if;
  conflicts:=public.local_import_conflicts(p_workspace_id,snapshot);
  if conflicts <> '{"customers":[],"interactions":[],"quotes":[],"quoteStatusChanges":[],"tasks":[]}'::jsonb then raise exception 'Import conflicts require explicit resolution: %', conflicts; end if;
  update public.local_imports set attempt_count=attempt_count+1,last_attempt_at=now() where id=item.id;
  insert into public.customers(id,workspace_id,name,business,email,phone,address,notes,created_at,updated_at) select x->>'id',p_workspace_id,x->>'name',coalesce(x->>'business',''),coalesce(x->>'email',''),coalesce(x->>'phone',''),coalesce(x->>'address',''),coalesce(x->>'notes',''),(x->>'createdAt')::timestamptz,(x->>'updatedAt')::timestamptz from jsonb_array_elements(coalesce(snapshot->'people','[]')) x;
  insert into public.customer_interactions(id,workspace_id,customer_id,note,created_at) select i->>'id',p_workspace_id,p->>'id',i->>'note',(i->>'createdAt')::timestamptz from jsonb_array_elements(coalesce(snapshot->'people','[]')) p cross join lateral jsonb_array_elements(coalesce(p->'interactions','[]')) i;
  insert into public.quotes(id,workspace_id,customer_id,service_description,amount_cents,currency,status,notes,created_at,updated_at) select x->>'id',p_workspace_id,x->>'customerId',x->>'serviceDescription',(x->>'amountCents')::integer,coalesce(x->>'currency','USD'),(x->>'status')::public.quote_status,coalesce(x->>'notes',''),(x->>'createdAt')::timestamptz,(x->>'updatedAt')::timestamptz from jsonb_array_elements(coalesce(snapshot->'quotes','[]')) x;
  insert into public.quote_status_history(id,workspace_id,quote_id,from_status,to_status,changed_at) select h->>'id',p_workspace_id,q->>'id',nullif(h->>'from','')::public.quote_status,(h->>'to')::public.quote_status,(h->>'changedAt')::timestamptz from jsonb_array_elements(coalesce(snapshot->'quotes','[]')) q cross join lateral jsonb_array_elements(coalesce(q->'statusHistory','[]')) h;
  insert into public.tasks(id,workspace_id,title,person,person_id,quote_id,due,completed,notes) select x->>'id',p_workspace_id,x->>'title',coalesce(x->>'person',''),nullif(x->>'personId',''),nullif(x->>'quoteId',''),nullif(x->>'due','')::timestamptz,coalesce((x->>'completed')::boolean,false),coalesce(x->>'notes','') from jsonb_array_elements(coalesce(snapshot->'tasks','[]')) x;
  insert into public.workspace_preferences(workspace_id,timezone,working_days,updated_at) values(p_workspace_id,coalesce(snapshot->>'timezone','America/Chicago'),coalesce(array(select jsonb_array_elements_text(coalesce(snapshot->'workingDays','[1,2,3,4,5]'::jsonb))::smallint),array[1,2,3,4,5]::smallint[]),now()) on conflict(workspace_id) do update set timezone=excluded.timezone,working_days=excluded.working_days,updated_at=now();
  select jsonb_build_object('customers',(select count(*) from public.customers r join jsonb_array_elements(coalesce(snapshot->'people','[]')) x on r.workspace_id=p_workspace_id and r.id=x->>'id'),'interactions',(select count(*) from public.customer_interactions r cross join jsonb_array_elements(coalesce(snapshot->'people','[]')) p cross join lateral jsonb_array_elements(coalesce(p->'interactions','[]')) i where r.workspace_id=p_workspace_id and r.id=i->>'id' and r.customer_id=p->>'id'),'quotes',(select count(*) from public.quotes r join jsonb_array_elements(coalesce(snapshot->'quotes','[]')) x on r.workspace_id=p_workspace_id and r.id=x->>'id'),'quoteStatusChanges',(select count(*) from public.quote_status_history r cross join jsonb_array_elements(coalesce(snapshot->'quotes','[]')) q cross join lateral jsonb_array_elements(coalesce(q->'statusHistory','[]')) h where r.workspace_id=p_workspace_id and r.id=h->>'id' and r.quote_id=q->>'id'),'tasks',(select count(*) from public.tasks r join jsonb_array_elements(coalesce(snapshot->'tasks','[]')) x on r.workspace_id=p_workspace_id and r.id=x->>'id' and r.person_id is not distinct from nullif(x->>'personId','') and r.quote_id is not distinct from nullif(x->>'quoteId',''))) into actual;
  if actual <> item.expected_counts then raise exception 'Database verification failed'; end if;
  update public.local_imports set state='completed',database_counts=actual,completed_at=now(),rollback_reason=null where id=item.id;
  return jsonb_build_object('import_id',item.id,'duplicate',false,'counts',actual);
end $$;
grant execute on function public.import_local_workspace(uuid,uuid,text,text) to authenticated;

create or replace function public.mark_local_import_rolled_back(p_workspace_id uuid,p_import_id uuid,p_reason text) returns void language plpgsql security invoker set search_path=public as $$
begin
  if not public.is_workspace_owner(p_workspace_id) then raise exception 'Workspace owner access required'; end if;
  update public.local_imports set state='rolled_back',rollback_reason=left(coalesce(p_reason,'Cloud transaction rejected'),300),rolled_back_at=now() where id=p_import_id and workspace_id=p_workspace_id and state='prepared';
  if not found then raise exception 'Prepared import was not found'; end if;
end $$;
grant execute on function public.mark_local_import_rolled_back(uuid,uuid,text) to authenticated;
