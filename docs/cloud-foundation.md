# Phase 3A.1 cloud foundation

LeadLoop remains browser-local by default. This milestone adds no live Supabase
project, deployment, cloud import, push notification, or user account. The
existing `leadloop.phase1.v1` store and tested voice/calendar flow are unchanged.

## Domain boundary

[`lib/domain/index.ts`](../lib/domain/index.ts) exposes the existing pure
calendar, conversation, customer-memory, quote, and task rules as one
framework-independent API. The Next.js page still uses its stable imports; a
future Expo app can consume the same rules without copying date parsing.

`CalendarExpression` resolves scheduling, `conversation-machine` controls
confirmation and stable draft IDs, and customer/quote modules own their records.
Cloud storage must not become a second calendar parser or confirmation engine.

## Database and tenancy

[`supabase/migrations/20261020000000_cloud_foundation.sql`](../supabase/migrations/20261020000000_cloud_foundation.sql)
creates:

- `workspaces` and `workspace_members` for authenticated business tenancy.
- `customers`, `customer_interactions`, `quotes`, `quote_status_history`, and
  `tasks`, retaining existing local IDs (including older non-UUID IDs) and customer/quote links.
- `workspace_preferences` for IANA zone and working days.
- `device_notification_tokens` for a later delivery service only.
- `local_imports` as an idempotency record for local-to-cloud migration.

Every business row has `workspace_id`. Row Level Security is enabled on every
table. Membership functions use `auth.uid()` and policies restrict both reads
and writes to members; device tokens additionally require their owning user.
Composite foreign keys keep task/customer/quote/history links within a single
workspace. The browser uses the Supabase anon key and authenticated user JWT;
service-role keys are never in web/mobile code.

## Authentication and typed access

`lib/cloud/supabase-browser.ts` creates a client only when
`NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are present.
Missing configuration returns `null`, keeping the existing local app usable.
`lib/cloud/repository.ts` scopes every query by `workspace_id`; database RLS is
the security authority. Attach auth UI only after a project is configured.

## Explicit local-data import

`lib/cloud/local-import.ts` provides the UI-independent import workflow:

1. Load and migrate `leadloop.phase1.v1` with existing compatibility rules.
2. Show a preview with record counts, relation errors, and legacy-link warnings.
3. Require the owner to explicitly approve import.
4. Save a local, non-destructive backup at
   `leadloop.phase1.v1.cloud-import-backup.v1` and a retry journal.
5. Send one idempotent `import_local_workspace` RPC keyed by workspace and a
   cryptographic source digest.
6. Verify server-returned customer, interaction, quote, quote-history, and task
   counts before reporting success.

A connection drop remains prepared and can be retried with the same digest without duplicate records. A confirmed database rejection is recorded separately as rolled back. Browser data is never deleted. The UI
for review/approval will be enabled only after configured authentication; this
prevents silently uploading customer data from a local prototype.

## Configure a Supabase project

1. Create a Supabase project and enable an auth provider (email/password or
   magic link is sufficient for this phase).
2. Apply the migration with `supabase db push` or the SQL editor.
3. In Authentication URL configuration, add local development and deployed web
   callback URLs before adding sign-in UI.
4. Copy only Project URL and anon/publishable key to `.env.local`:
   ```bash
   NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=YOUR_PUBLISHABLE_ANON_KEY
   ```
5. Keep `SUPABASE_SERVICE_ROLE_KEY` in a trusted deployment secret store only;
   it is not required by the browser or mobile app.
6. Sign in, call `create_workspace`, then present the import preview and request
   owner approval before invoking the import RPC.

Before production, run the migration against a disposable project and use
Supabase policy tests or SQL role tests with two users in two workspaces.

## Known limits

There is no live database, deployed auth UI, cloud sync, notification delivery,
Siri integration, Expo build, real iPhone test, or automatic local-data upload
in this milestone. The mobile interfaces are contracts only. The Postgres
migration should be applied to a test project before a pilot.
