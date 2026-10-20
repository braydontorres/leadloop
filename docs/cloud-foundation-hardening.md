# Cloud foundation hardening

This follow-up must be applied instead of the earlier Phase 3A.1 migration in a
new, empty test project. It has not been deployed by LeadLoop.

## Import authorization and integrity

Only a workspace owner can prepare, execute, inspect, or mark an import rolled
back. Ordinary workspace members can continue to use shared business data under
RLS but cannot move a browser database into the workspace.

The browser creates canonical JSON and a `sha256:<64 hex>` digest with Web
Crypto. It sends both exact JSON text and digest. PostgreSQL independently
computes `pgcrypto.digest()` over that same received text before parsing it,
which prevents a changed payload from borrowing another snapshot’s approval.

`prepare_local_import` checks all incoming IDs against actual workspace records.
Any customer, interaction, quote, quote-history, or task collision is returned
as an explicit conflict. The import then stops; it never upserts or overwrites
an existing cloud record. Resolving a conflict requires an owner to cancel,
choose a deliberate record-remapping process, or use a different snapshot. No
automatic merge policy exists in this milestone.

After inserts, the RPC reads records and customer/quote/task links back from the
database and compares those actual counts with the prepared counts. Constraints
also reject mismatched workspace links. The RPC only marks an import completed
after this verification passes.

## Import journal

- `prepared`: preflight succeeded; no records have been imported yet. A dropped
  browser connection remains here because its result is unknown and is safe to
  retry with the same digest.
- `completed`: the transaction committed and returned database-derived counts.
  Repeating the same digest is idempotent.
- `rolled_back`: the browser received a confirmed database rejection and then
  recorded a safe, short failure reason in a separate request.

Local data remains untouched in all cases. The browser backup and retry journal
stay under `leadloop.phase1.v1.*` keys.

## Database policy test

[`supabase/tests/cloud-foundation-hardening.sql`](../supabase/tests/cloud-foundation-hardening.sql)
uses pgTAP, two authenticated users, and two workspaces. It tests cross-workspace
read/write denial, owner-only import preparation, digest rejection, and absence
of a journal record after a rejected preflight.

Run it only against a disposable local Supabase database after applying the
migration:

```bash
supabase start
supabase db reset
supabase test db --file supabase/tests/cloud-foundation-hardening.sql
```

The test is not runnable in this repository workspace because Supabase CLI and
a disposable PostgreSQL/Supabase instance are not configured here.
