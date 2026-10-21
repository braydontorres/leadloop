-- Phase 3A.2 follow-up: PostgREST needs table privileges in addition to RLS.
-- These grants do not bypass RLS; every browser request remains filtered by the
-- existing authenticated policies in 20261020000000_cloud_foundation.sql.

-- Workspace rows are created only through create_workspace(). Members may list
-- and update rows only where the owner RLS policy permits it.
grant select, update on table public.workspaces to authenticated;
grant select on table public.workspace_members to authenticated;

-- Browser CRUD and the authenticated, security-invoker import RPCs require
-- these exact table operations. Workspace membership remains enforced by RLS.
grant select, insert, update on table public.workspace_preferences to authenticated;
grant select, insert, update, delete on table public.customers to authenticated;
grant select, insert, update, delete on table public.customer_interactions to authenticated;
grant select, insert, update, delete on table public.quotes to authenticated;
grant select, insert, update, delete on table public.quote_status_history to authenticated;
grant select, insert, update, delete on table public.tasks to authenticated;
grant select, insert, update, delete on table public.device_notification_tokens to authenticated;

-- Import records are append/update-only from the browser. The owner-only RLS
-- policy protects metadata and the security-invoker RPCs never delete imports.
grant select, insert, update on table public.local_imports to authenticated;

-- PostgreSQL grants EXECUTE to PUBLIC by default for new functions. Make the
-- browser RPC boundary explicit: unauthenticated callers cannot create a
-- workspace, inspect imports, or invoke the security-definer helpers.
revoke all on function public.create_workspace(text) from public;
revoke all on function public.local_import_conflicts(uuid, jsonb) from public;
revoke all on function public.prepare_local_import(uuid, text, text) from public;
revoke all on function public.import_local_workspace(uuid, uuid, text, text) from public;
revoke all on function public.mark_local_import_rolled_back(uuid, uuid, text) from public;

grant execute on function public.create_workspace(text) to authenticated;
grant execute on function public.local_import_conflicts(uuid, jsonb) to authenticated;
grant execute on function public.prepare_local_import(uuid, text, text) to authenticated;
grant execute on function public.import_local_workspace(uuid, uuid, text, text) to authenticated;
grant execute on function public.mark_local_import_rolled_back(uuid, uuid, text) to authenticated;
