-- LeadLoop Phase 3A.1 cloud foundation. Apply with the Supabase CLI or SQL editor.
-- This migration has no production credentials and does not move browser data by itself.
create extension if not exists pgcrypto;

create type public.workspace_role as enum ('owner', 'member');
create type public.quote_status as enum ('draft', 'sent', 'accepted', 'declined');
create type public.import_state as enum ('started', 'completed', 'failed');

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 1 and 160),
  owner_user_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.workspace_role not null default 'member',
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create or replace function public.is_workspace_member(target_workspace uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.workspace_members
    where workspace_id = target_workspace and user_id = auth.uid()
  );
$$;
create or replace function public.is_workspace_owner(target_workspace uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.workspace_members
    where workspace_id = target_workspace and user_id = auth.uid() and role = 'owner'
  );
$$;
revoke all on function public.is_workspace_member(uuid) from public;
revoke all on function public.is_workspace_owner(uuid) from public;
grant execute on function public.is_workspace_member(uuid), public.is_workspace_owner(uuid) to authenticated;

create table public.workspace_preferences (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  timezone text not null check (char_length(timezone) between 1 and 100),
  working_days smallint[] not null default array[1,2,3,4,5]::smallint[]
    check (working_days <@ array[0,1,2,3,4,5,6]::smallint[]),
  updated_at timestamptz not null default now()
);
create table public.customers (
  id text not null check (char_length(id) between 1 and 160),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 160),
  business text not null default '', email text not null default '', phone text not null default '',
  address text not null default '', notes text not null default '',
  created_at timestamptz not null, updated_at timestamptz not null,
  primary key (workspace_id, id)
);
create index customers_workspace_name_idx on public.customers(workspace_id, lower(name));
create table public.customer_interactions (
  id text not null check (char_length(id) between 1 and 160),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  customer_id text not null,
  note text not null check (char_length(note) <= 10000),
  created_at timestamptz not null,
  primary key (workspace_id, id),
  foreign key (workspace_id, customer_id) references public.customers(workspace_id, id) on delete cascade
);
create table public.quotes (
  id text not null check (char_length(id) between 1 and 160),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  customer_id text not null,
  service_description text not null check (char_length(trim(service_description)) between 1 and 240),
  amount_cents integer not null check (amount_cents > 0 and amount_cents <= 100000000),
  currency text not null default 'USD' check (currency = 'USD'),
  status public.quote_status not null default 'draft', notes text not null default '',
  created_at timestamptz not null, updated_at timestamptz not null,
  primary key (workspace_id, id),
  foreign key (workspace_id, customer_id) references public.customers(workspace_id, id) on delete restrict
);
create table public.quote_status_history (
  id text not null check (char_length(id) between 1 and 160),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  quote_id text not null,
  from_status public.quote_status, to_status public.quote_status not null,
  changed_at timestamptz not null,
  primary key (workspace_id, id),
  foreign key (workspace_id, quote_id) references public.quotes(workspace_id, id) on delete cascade
);
create table public.tasks (
  id text not null check (char_length(id) between 1 and 160),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  title text not null check (char_length(trim(title)) between 1 and 240),
  person text not null default '', person_id text, quote_id text,
  due timestamptz, completed boolean not null default false, notes text not null default '',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  primary key (workspace_id, id),
  foreign key (workspace_id, person_id) references public.customers(workspace_id, id) on delete set null (person_id),
  foreign key (workspace_id, quote_id) references public.quotes(workspace_id, id) on delete set null (quote_id)
);
create index tasks_workspace_due_idx on public.tasks(workspace_id, due) where not completed;
create table public.device_notification_tokens (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  token text not null, platform text not null check (platform in ('ios', 'android', 'web')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (workspace_id, user_id, token)
);
create table public.local_imports (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  initiated_by uuid not null references auth.users(id) on delete restrict,
  source_fingerprint text not null check (char_length(source_fingerprint) between 1 and 200),
  state public.import_state not null default 'started', counts jsonb not null default '{}'::jsonb,
  failure_reason text, created_at timestamptz not null default now(), completed_at timestamptz,
  unique (workspace_id, source_fingerprint)
);

alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.workspace_preferences enable row level security;
alter table public.customers enable row level security;
alter table public.customer_interactions enable row level security;
alter table public.quotes enable row level security;
alter table public.quote_status_history enable row level security;
alter table public.tasks enable row level security;
alter table public.device_notification_tokens enable row level security;
alter table public.local_imports enable row level security;

create policy workspace_select on public.workspaces for select to authenticated using (public.is_workspace_member(id));
create policy workspace_update on public.workspaces for update to authenticated using (public.is_workspace_owner(id)) with check (public.is_workspace_owner(id));
create policy member_select on public.workspace_members for select to authenticated using (public.is_workspace_member(workspace_id));
create policy member_manage on public.workspace_members for all to authenticated using (public.is_workspace_owner(workspace_id)) with check (public.is_workspace_owner(workspace_id));

-- Every domain table is scoped by membership; write policy also checks the incoming row.
create policy preferences_access on public.workspace_preferences for all to authenticated using (public.is_workspace_member(workspace_id)) with check (public.is_workspace_member(workspace_id));
create policy customers_access on public.customers for all to authenticated using (public.is_workspace_member(workspace_id)) with check (public.is_workspace_member(workspace_id));
create policy interactions_access on public.customer_interactions for all to authenticated using (public.is_workspace_member(workspace_id)) with check (public.is_workspace_member(workspace_id));
create policy quotes_access on public.quotes for all to authenticated using (public.is_workspace_member(workspace_id)) with check (public.is_workspace_member(workspace_id));
create policy quote_history_access on public.quote_status_history for all to authenticated using (public.is_workspace_member(workspace_id)) with check (public.is_workspace_member(workspace_id));
create policy tasks_access on public.tasks for all to authenticated using (public.is_workspace_member(workspace_id)) with check (public.is_workspace_member(workspace_id));
create policy device_token_access on public.device_notification_tokens for select to authenticated using (user_id = auth.uid() and public.is_workspace_member(workspace_id));
create policy device_token_write on public.device_notification_tokens for all to authenticated using (user_id = auth.uid() and public.is_workspace_member(workspace_id)) with check (user_id = auth.uid() and public.is_workspace_member(workspace_id));
create policy imports_access on public.local_imports for all to authenticated using (initiated_by = auth.uid() and public.is_workspace_member(workspace_id)) with check (initiated_by = auth.uid() and public.is_workspace_member(workspace_id));

create or replace function public.create_workspace(workspace_name text)
returns public.workspaces language plpgsql security definer set search_path = public as $$
declare created public.workspaces;
begin
  if auth.uid() is null then raise exception 'Authentication is required'; end if;
  insert into public.workspaces (name, owner_user_id) values (workspace_name, auth.uid()) returning * into created;
  insert into public.workspace_members (workspace_id, user_id, role) values (created.id, auth.uid(), 'owner');
  insert into public.workspace_preferences (workspace_id, timezone) values (created.id, 'America/Chicago');
  return created;
end;
$$;
grant execute on function public.create_workspace(text) to authenticated;

-- One RPC means retrying an interrupted browser request cannot create partial or duplicate records.
create or replace function public.import_local_workspace(
  p_workspace_id uuid, p_source_fingerprint text, p_snapshot jsonb
) returns jsonb language plpgsql security invoker set search_path = public as $$
declare existing public.local_imports; imported public.local_imports; counts jsonb;
begin
  if not public.is_workspace_member(p_workspace_id) then raise exception 'Workspace access denied'; end if;
  select * into existing from public.local_imports where workspace_id=p_workspace_id and source_fingerprint=p_source_fingerprint;
  if found and existing.state = 'completed' then
    return jsonb_build_object('import_id', existing.id, 'duplicate', true, 'counts', existing.counts);
  end if;
  insert into public.local_imports(workspace_id, initiated_by, source_fingerprint, state)
  values (p_workspace_id, auth.uid(), p_source_fingerprint, 'started')
  on conflict (workspace_id, source_fingerprint) do update set initiated_by=excluded.initiated_by, state='started', failure_reason=null
  returning * into imported;

  insert into public.customers(id,workspace_id,name,business,email,phone,address,notes,created_at,updated_at)
  select (x->>'id'),p_workspace_id,x->>'name',coalesce(x->>'business',''),coalesce(x->>'email',''),coalesce(x->>'phone',''),coalesce(x->>'address',''),coalesce(x->>'notes',''),(x->>'createdAt')::timestamptz,(x->>'updatedAt')::timestamptz from jsonb_array_elements(coalesce(p_snapshot->'people','[]')) x
  on conflict (workspace_id, id) do update set name=excluded.name,business=excluded.business,email=excluded.email,phone=excluded.phone,address=excluded.address,notes=excluded.notes,updated_at=excluded.updated_at;
  insert into public.customer_interactions(id,workspace_id,customer_id,note,created_at)
  select (i->>'id'),p_workspace_id,(p->>'id'),i->>'note',(i->>'createdAt')::timestamptz from jsonb_array_elements(coalesce(p_snapshot->'people','[]')) p cross join lateral jsonb_array_elements(coalesce(p->'interactions','[]')) i
  on conflict (workspace_id, id) do nothing;
  insert into public.quotes(id,workspace_id,customer_id,service_description,amount_cents,currency,status,notes,created_at,updated_at)
  select (x->>'id'),p_workspace_id,(x->>'customerId'),x->>'serviceDescription',(x->>'amountCents')::integer,coalesce(x->>'currency','USD')::text,(x->>'status')::public.quote_status,coalesce(x->>'notes',''),(x->>'createdAt')::timestamptz,(x->>'updatedAt')::timestamptz from jsonb_array_elements(coalesce(p_snapshot->'quotes','[]')) x
  on conflict (workspace_id, id) do update set service_description=excluded.service_description,amount_cents=excluded.amount_cents,status=excluded.status,notes=excluded.notes,updated_at=excluded.updated_at;
  insert into public.quote_status_history(id,workspace_id,quote_id,from_status,to_status,changed_at)
  select (h->>'id'),p_workspace_id,(q->>'id'),nullif(h->>'from','')::public.quote_status,(h->>'to')::public.quote_status,(h->>'changedAt')::timestamptz from jsonb_array_elements(coalesce(p_snapshot->'quotes','[]')) q cross join lateral jsonb_array_elements(coalesce(q->'statusHistory','[]')) h
  on conflict (workspace_id, id) do nothing;
  insert into public.tasks(id,workspace_id,title,person,person_id,quote_id,due,completed,notes)
  select (x->>'id'),p_workspace_id,x->>'title',coalesce(x->>'person',''),nullif(x->>'personId',''),nullif(x->>'quoteId',''),nullif(x->>'due','')::timestamptz,coalesce((x->>'completed')::boolean,false),coalesce(x->>'notes','') from jsonb_array_elements(coalesce(p_snapshot->'tasks','[]')) x
  on conflict (workspace_id, id) do update set title=excluded.title,person=excluded.person,person_id=excluded.person_id,quote_id=excluded.quote_id,due=excluded.due,completed=excluded.completed,notes=excluded.notes,updated_at=now();
  insert into public.workspace_preferences(workspace_id,timezone,working_days,updated_at) values(p_workspace_id,coalesce(p_snapshot->>'timezone','America/Chicago'),coalesce(array(select jsonb_array_elements_text(coalesce(p_snapshot->'workingDays','[1,2,3,4,5]'::jsonb))::smallint),array[1,2,3,4,5]::smallint[]),now()) on conflict(workspace_id) do update set timezone=excluded.timezone,working_days=excluded.working_days,updated_at=now();
  counts := jsonb_build_object('customers',jsonb_array_length(coalesce(p_snapshot->'people','[]')),'interactions',coalesce((select sum(jsonb_array_length(coalesce(x->'interactions','[]'))) from jsonb_array_elements(coalesce(p_snapshot->'people','[]')) x),0),'quotes',jsonb_array_length(coalesce(p_snapshot->'quotes','[]')),'quoteStatusChanges',coalesce((select sum(jsonb_array_length(coalesce(x->'statusHistory','[]'))) from jsonb_array_elements(coalesce(p_snapshot->'quotes','[]')) x),0),'tasks',jsonb_array_length(coalesce(p_snapshot->'tasks','[]')));
  update public.local_imports set state='completed',counts=counts,completed_at=now(),failure_reason=null where id=imported.id;
  return jsonb_build_object('import_id',imported.id,'duplicate',false,'counts',counts);
exception when others then
  update public.local_imports set state='failed',failure_reason=left(sqlerrm, 500) where workspace_id=p_workspace_id and source_fingerprint=p_source_fingerprint;
  raise;
end;
$$;
grant execute on function public.import_local_workspace(uuid,text,jsonb) to authenticated;
