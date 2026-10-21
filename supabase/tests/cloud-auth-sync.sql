-- Phase 3A.2 real PostgreSQL/RLS checks. Run after every migration on a disposable local database:
--   supabase test db --file supabase/tests/cloud-auth-sync.sql
begin;
create extension if not exists pgtap;
select plan(8);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-0000000003a1','00000000-0000-0000-0000-000000000000','authenticated','authenticated','cloud-owner@example.test','not-used',now(),'{}','{}',now(),now()),
  ('00000000-0000-0000-0000-0000000003b2','00000000-0000-0000-0000-000000000000','authenticated','authenticated','cloud-other@example.test','not-used',now(),'{}','{}',now(),now());
insert into public.workspaces(id,name,business_name,owner_user_id) values
  ('30000000-0000-0000-0000-0000000003a1','Owner workspace','Owner business','00000000-0000-0000-0000-0000000003a1'),
  ('30000000-0000-0000-0000-0000000003b2','Other workspace','Other business','00000000-0000-0000-0000-0000000003b2');
insert into public.workspace_members(workspace_id,user_id,role) values
  ('30000000-0000-0000-0000-0000000003a1','00000000-0000-0000-0000-0000000003a1','owner'),
  ('30000000-0000-0000-0000-0000000003b2','00000000-0000-0000-0000-0000000003b2','owner');
insert into public.workspace_preferences(workspace_id,timezone,owner_name) values
  ('30000000-0000-0000-0000-0000000003a1','America/Chicago','Owner'),
  ('30000000-0000-0000-0000-0000000003b2','America/Denver','Other');

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000003a1',true);
select lives_ok($$update public.workspaces set business_name='Renamed business' where id='30000000-0000-0000-0000-0000000003a1'$$, 'owner updates its cloud business profile');
select results_eq($$select business_name from public.workspaces where id='30000000-0000-0000-0000-0000000003a1'$$, array['Renamed business'], 'updated business profile is readable in the owner workspace');
select lives_ok($$insert into public.customers(id,workspace_id,name,created_at,updated_at) values('customer-cloud','30000000-0000-0000-0000-0000000003a1','Cloud Customer',now(),now()); insert into public.quotes(id,workspace_id,customer_id,service_description,amount_cents,currency,status,created_at,updated_at) values('quote-cloud','30000000-0000-0000-0000-0000000003a1','customer-cloud','Driveway cleaning',25000,'USD','draft',now(),now()); insert into public.tasks(id,workspace_id,title,person,person_id,quote_id,due,completed,notes) values('task-cloud','30000000-0000-0000-0000-0000000003a1','Call customer','Cloud Customer','customer-cloud','quote-cloud','2026-10-22T20:00:00Z',false,'');$$, 'owner can create linked customer, quote, and task records');
select results_eq($$select count(*)::int from public.tasks where workspace_id='30000000-0000-0000-0000-0000000003a1' and person_id='customer-cloud' and quote_id='quote-cloud'$$, array[1], 'cloud task retains stable customer and quote links');

select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000003b2',true);
select is_empty($$select * from public.customers where workspace_id='30000000-0000-0000-0000-0000000003a1'$$, 'another authenticated workspace cannot read owner customer data');
select is_empty($$update public.workspaces set business_name='Blocked' where id='30000000-0000-0000-0000-0000000003a1' returning id$$, 'another workspace cannot update owner profile');
select throws_ok($$insert into public.tasks(id,workspace_id,title,person,completed,notes) values('cross-task','30000000-0000-0000-0000-0000000003a1','Blocked','',false,'')$$, '42501', null, 'another workspace cannot create a task in the owner workspace');
select is_empty($$select * from public.workspace_preferences where workspace_id='30000000-0000-0000-0000-0000000003a1'$$, 'another workspace cannot read owner preferences');

select * from finish();
rollback;
