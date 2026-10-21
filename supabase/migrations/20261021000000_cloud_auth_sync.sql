-- Phase 3A.2. This follows the already-deployed cloud foundation migration.
-- It adds only profile fields required to reconstruct the existing local Store.
alter table public.workspaces add column if not exists business_name text not null default '' check (char_length(business_name) <= 160);
alter table public.workspace_preferences add column if not exists owner_name text not null default '' check (char_length(owner_name) <= 160);
