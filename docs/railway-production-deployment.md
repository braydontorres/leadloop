# Railway production backend

This guide deploys the existing Next.js service. It does not deploy Supabase
migrations, import local browser data, or change the iPhone's API address.

## Runtime contract

- **Node.js:** 22.x, declared in `package.json`.
- **Build:** `npm run build` after Railway installs dependencies from
  `package-lock.json`.
- **Start:** `npm run start`, which runs `next start --hostname 0.0.0.0`.
- **Port:** Railway supplies `PORT`; `next start` reads it automatically. Do
  not set a fixed production port.
- **Health check:** `GET /api/health` returns only
  `{"status":"ok","service":"leadloop-api"}` with `Cache-Control: no-store`.

`railway.toml` records these settings. The service has no disk or database
migration requirement; Supabase remains the system of record.

## Configure Railway

1. In Railway, create a **New Project** and select **Deploy from GitHub**.
2. Select `braydontorres/leadloop`, then select the reviewed deployment branch
   and the repository root as the service root.
3. Leave the build and start commands from `railway.toml` in place. Railway
   installs dependencies, runs `npm run build`, and starts `npm run start`.
4. Add the variables below in Railway's service **Variables** screen. Add
   values there only; never commit them to Git or paste them into a client app.
5. Create a Railway public domain. Before enabling web email links on that
   domain, add its exact callback URL to Supabase Auth's redirect allow-list.
6. Deploy only after reviewing the build logs. Confirm the Railway health check
   succeeds before directing the iPhone app to the new URL.

## Required service variables

| Name                                   | Purpose                                                                     | Required                                                                    |
| -------------------------------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `OPENAI_API_KEY`                       | Server-only OpenAI transcription and interpretation key for voice requests. | Yes for `/api/mobile/voice`; no for health checks and typed local-only use. |
| `NEXT_PUBLIC_SUPABASE_URL`             | Supabase project base URL, for example `https://project-ref.supabase.co`.   | Yes for authenticated cloud and mobile voice.                               |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Current Supabase browser-safe publishable key.                              | Yes, unless using the legacy key below.                                     |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY`        | Legacy alternative to the publishable key.                                  | Use only when the project does not have a publishable key.                  |

Use exactly one of `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` and
`NEXT_PUBLIC_SUPABASE_ANON_KEY`; the publishable key takes precedence. Values
with `NEXT_PUBLIC_` are intentionally browser-visible Supabase configuration,
not server secrets. Do **not** configure `SUPABASE_SERVICE_ROLE_KEY` or any
`EXPO_PUBLIC_*` value on this service. `PORT` and `NODE_ENV` are supplied by
Railway; do not set them to a fixed value.

## Security review of mobile voice

`POST /api/mobile/voice` runs in the Node.js runtime and accepts multipart
uploads under the `audio` field. It:

1. validates the workspace UUID and authenticates the Bearer JWT with Supabase;
2. confirms membership through `workspace_members` while RLS is active;
3. accepts only allowlisted audio MIME types, including the Expo iPhone M4A
   (`audio/m4a` / MP4) format;
4. rejects empty files and files over 10 MiB, and rejects declared durations
   over 90 seconds;
5. rate-limits each authenticated user (12 requests per 10 minutes in
   production);
6. sends the in-memory audio to OpenAI only after the preceding checks pass;
7. uses the existing OpenAI request timeout and returns safe API errors.

The route does not write recordings to disk. Its production logs contain only
operation stage, timing, safe error code/status, and request ID where
available. They do not log audio, transcript text, authorization tokens,
customer records, or API keys. The route uses the public Supabase key together
with the caller JWT; it never uses a Supabase service-role key.

### Mobile authentication diagnostics

An HTTP 401 from the mobile voice route now has a safe, specific `errorType`
in host logs and a matching `code` in the JSON response:

| Code                              | Meaning                                                                 | Next action                                                                                        |
| --------------------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `MOBILE_AUTH_HEADER_MISSING`      | The API did not receive an Authorization header.                        | Check the deployed Expo build and its configured API URL; do not change Supabase credentials.      |
| `MOBILE_AUTH_HEADER_MALFORMED`    | The header was present but was not a usable Bearer value.               | Rebuild/reload the mobile bundle and sign in again.                                                |
| `MOBILE_AUTH_TOKEN_REJECTED`      | Supabase Auth rejected the received access token.                       | Sign out and in once; if it repeats, verify the mobile app and host use the same Supabase project. |
| `MOBILE_AUTH_SERVICE_UNAVAILABLE` | The host could not contact Supabase Auth or received a service failure. | Check the host-to-Supabase network/service status and retry.                                       |

These categories intentionally omit tokens, email addresses, request headers,
and raw Supabase error messages.

## Pre-deploy checks

Run these from the repository root before connecting the service:

```bash
npm ci
npm run typecheck
npm test
npm run build
npm run format:check
npm run test:e2e
```

For a local production smoke test, create a private `.env.local` with the
required values, then run:

```bash
npm run build
PORT=3000 npm run start
curl --fail --silent --show-error http://127.0.0.1:3000/api/health
```

Do not send real customer audio to a local smoke test. The health endpoint
needs no credentials.

## Post-deploy acceptance tests

1. Open `https://YOUR_RAILWAY_DOMAIN/api/health`. Expect HTTP 200 and exactly
   the two non-sensitive fields listed above.
2. Send a multipart request with a syntactically valid `workspaceId` but no
   Bearer token. Expect HTTP 401 and `MOBILE_AUTH_REQUIRED`; it must not call
   OpenAI.
3. With a test account that is a member of a test workspace, use the existing
   iPhone Capture screen to record a short M4A below 10 MiB. Confirm it shows a
   transcription, asks or reads back reminder details, and saves only after an
   explicit confirmation.
4. Verify the new reminder appears after app reload in the same Supabase
   workspace. Repeat with a user from a different workspace and confirm access
   is denied.
5. Test a file over 10 MiB in a non-production test workspace. Expect HTTP
   413; do not raise the application limit to accommodate it.

Only after these checks should the mobile release configuration change
`EXPO_PUBLIC_LEADLOOP_VOICE_API_URL` to the Railway HTTPS domain. That mobile
configuration change is deliberately outside this preparation branch.

## Billing and operational review

No Railway project, deployment, or paid API call is created by these changes.
Before deploying, review Railway's current plan requirements, included usage,
compute uptime, egress, log retention, and any trial-credit expiration. This
service does not require a Railway volume.

Railway hosting is separate from existing Supabase and OpenAI billing. Voice
requests continue to incur OpenAI transcription and interpretation usage. Set
an OpenAI project budget and usage alerts, and use a small test workspace for
the first physical-iPhone acceptance test. Confirm current vendor pricing in
their consoles because plan names and prices change.

## Rollback and remaining prerequisites

Railway can redeploy the preceding Git commit if the health check or voice
acceptance test fails. Do not change or delete Supabase data as part of a
rollback. Until a Railway domain is deployed and tested, the iPhone keeps its
current API URL and continues to require its current local/tunnel path.

Before production use, an owner still needs to create the Railway service,
enter the required variables, create a public HTTPS domain, confirm Supabase
Auth redirect URLs for web login, and complete the post-deploy tests above.
