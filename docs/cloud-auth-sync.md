# Phase 3A.2: authenticated cloud workspaces

LeadLoop can run in either browser-local mode or authenticated cloud mode. It remains browser-local when the Supabase browser configuration is absent. Cloud mode uses the Supabase **publishable anon key** with Row Level Security; it never uses a service-role key in the browser.

## Hosted project configuration

1. In the Supabase project, enable Email auth and Email confirmation.
2. Add the web origins to Authentication URL Configuration, including `http://localhost:3000` for development and the production site URL when it exists.
3. Apply the already-deployed cloud foundation migration first, followed by the new Phase 3A.2 migration:

   ```bash
   supabase db push
   ```

4. Create `.env.local` in the web project (do not commit it):

   ```bash
   NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_KEY
   ```

`NEXT_PUBLIC_SUPABASE_URL` must be the project **base URL only**: `https://YOUR_PROJECT.supabase.co`. Do not append `/auth/v1`, `/rest/v1`, a query string, or a second protocol. LeadLoop validates this before sending an Auth request and displays a safe correction message if it is malformed.

`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` is a publishable client credential and is protected by RLS. Existing projects may instead use `NEXT_PUBLIC_SUPABASE_ANON_KEY`; LeadLoop accepts either name. Do not add `SUPABASE_SERVICE_ROLE_KEY`, OpenAI keys, or any private provider credential to `.env.local` for browser code.

## Account and workspace flow

1. Open **Settings → Cloud account**.
2. Create an account. With confirmation enabled, LeadLoop says to check email. The confirmation link exchanges its one-time code in the browser, removes it from the address bar, and either signs the user in or asks them to sign in.
3. **Forgot password** sends a recovery email to the configured browser origin. Its link enters the new-password screen; a successful update keeps the authenticated session.
4. Create a workspace or select one the account belongs to. A new workspace defaults to `America/Chicago` and Monday–Friday, consistent with the existing local defaults.
5. Browser data is **not** uploaded at sign-in or workspace creation. An owner can choose **Preview local-data import**, inspect the count and validation result, then choose **Approve and import**.
6. The import creates a browser backup, preserves existing record IDs and links, uses the server-side SHA-256/idempotency/conflict checks, and leaves the original `leadloop.phase1.v1` browser payload untouched.
7. Once a cloud workspace is loaded, customer, quote, task, interaction, preference, and profile changes are debounced and persisted to that workspace. The Settings status shows `saving`, `saved`, or `error`; an error means the visible change has not been confirmed in cloud storage.

Only workspace owners can run a local-data import. RLS remains the authority for every read and write, including direct client requests. Signing out restores the local browser workspace in memory. Expired sessions also return to local mode instead of continuing cloud writes.

## Manual acceptance check

1. Start the site with the two public Supabase variables configured.
2. Create and confirm a test account, sign in, and create a test workspace.
3. In Settings, preview and approve a small local import. Confirm the summary counts and keep the browser backup.
4. Create a reminder through Capture & Review, confirm it, refresh the page, sign in/select the workspace again, and verify the reminder remains.
5. Add a customer and a quote, then refresh and verify their stable links and reminder association remain.
6. Sign out. Confirm the existing browser-local workspace is still available.

Automated route/UI tests mock Supabase, microphone, speech synthesis, and AI. Local database security tests can be run separately with `npm run test:db:cloud` and `npm run test:db:auth-sync`; hosted Supabase, email delivery, and physical microphone behavior require this manual check.
