-- Run only against a disposable Supabase local/test database after the migration:
--   supabase test db --file supabase/tests/cloud-foundation-hardening.sql
-- This is a real PostgreSQL RLS/RPC test, not a browser mock.
begin;
create extension if not exists pgtap;
select plan(13);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-000000000000','authenticated','authenticated','owner-a@example.test','not-used',now(),'{"provider":"email","providers":["email"]}','{}',now(),now()),
  ('00000000-0000-0000-0000-0000000000b2','00000000-0000-0000-0000-000000000000','authenticated','authenticated','owner-b@example.test','not-used',now(),'{"provider":"email","providers":["email"]}','{}',now(),now());
insert into public.workspaces(id,name,owner_user_id) values
  ('10000000-0000-0000-0000-0000000000a1','A','00000000-0000-0000-0000-0000000000a1'),
  ('20000000-0000-0000-0000-0000000000b2','B','00000000-0000-0000-0000-0000000000b2');
insert into public.workspace_members(workspace_id,user_id,role) values
  ('10000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000a1','owner'),
  ('10000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000b2','member'),
  ('20000000-0000-0000-0000-0000000000b2','00000000-0000-0000-0000-0000000000b2','owner');
insert into public.customers(id,workspace_id,name,created_at,updated_at) values ('customer-a','10000000-0000-0000-0000-0000000000a1','Customer A',now(),now());
create function pg_temp.snapshot() returns text language sql immutable as $$ select '{"people":[{"id":"imported-customer","name":"Imported","business":"","email":"","phone":"","address":"","notes":"","createdAt":"2026-10-20T00:00:00Z","updatedAt":"2026-10-20T00:00:00Z","interactions":[]}],"quotes":[],"tasks":[],"timezone":"America/Chicago","workingDays":[1,2,3,4,5],"name":"","business":""}' $$;
create function pg_temp.digest_of(value text) returns text language sql immutable as $$ select 'sha256:' || encode(digest(convert_to(value,'UTF8'),'sha256'),'hex') $$;

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1',true);
select results_eq('select count(*)::int from public.customers where workspace_id=''10000000-0000-0000-0000-0000000000a1''', array[1], 'owner sees own workspace');
select is_empty('select * from public.customers where workspace_id=''20000000-0000-0000-0000-0000000000b2''', 'owner A cannot read workspace B');
select throws_ok($$insert into public.customers(id,workspace_id,name,created_at,updated_at) values('cross-write','20000000-0000-0000-0000-0000000000b2','No',now(),now())$$, '42501', null, 'owner A cannot write workspace B');

select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000b2',true);
select results_eq('select count(*)::int from public.customers where workspace_id=''10000000-0000-0000-0000-0000000000a1''', array[1], 'member can read shared workspace');
select throws_ok($$select public.prepare_local_import('10000000-0000-0000-0000-0000000000a1','sha256:0000000000000000000000000000000000000000000000000000000000000000','{}')$$, 'P0001', 'Workspace owner access required', 'member cannot prepare an import');

select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1',true);
select throws_ok($$select public.prepare_local_import('10000000-0000-0000-0000-0000000000a1','sha256:0000000000000000000000000000000000000000000000000000000000000000','{}')$$, 'P0001', 'Snapshot digest does not match supplied JSON', 'server rejects a mismatched digest');
select results_eq('select count(*)::int from public.local_imports', array[0], 'rejected preparation leaves no import journal record');

select is((select (public.prepare_local_import('10000000-0000-0000-0000-0000000000a1',pg_temp.digest_of(pg_temp.snapshot()),pg_temp.snapshot())->>'ready')), 'true', 'owner prepares a valid import');
select is((select (public.import_local_workspace('10000000-0000-0000-0000-0000000000a1',(select id from public.local_imports),pg_temp.digest_of(pg_temp.snapshot()),pg_temp.snapshot())->>'duplicate')), 'false', 'first import commits once');
select results_eq('select count(*)::int from public.customers where workspace_id=''10000000-0000-0000-0000-0000000000a1'' and id=''imported-customer''', array[1], 'successful import is verified in database state');
select is((select (public.prepare_local_import('10000000-0000-0000-0000-0000000000a1',pg_temp.digest_of(pg_temp.snapshot()),pg_temp.snapshot())->>'duplicate')), 'true', 'identical retry returns completed import before conflicts');
select is((select (public.import_local_workspace('10000000-0000-0000-0000-0000000000a1',(select id from public.local_imports),pg_temp.digest_of(pg_temp.snapshot()),pg_temp.snapshot())->>'duplicate')), 'true', 'identical execution retry is idempotent');
select is((select (public.prepare_local_import('10000000-0000-0000-0000-0000000000a1',pg_temp.digest_of(replace(pg_temp.snapshot(),'"Imported"','"Changed"')),replace(pg_temp.snapshot(),'"Imported"','"Changed"'))->>'ready')), 'false', 'different snapshot with matching ID is a conflict');

select * from finish();
rollback;
