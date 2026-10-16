# LeadLoop

**Just talk. We’ll remember.** A mobile-first workspace for small business owners.

## Current milestone: Phase 1

A functioning local prototype built with Next.js, TypeScript, Tailwind CSS, and Lucide icons. Includes Home, Capture & Review, Tasks, People, and Settings.

- Type a thought, review its details, and explicitly confirm before saving.
- Create, edit, complete, reopen, search, and delete tasks.
- Keep contact records and notes; associate a task with a person.
- Choose exact dates and times and see confirmation dates in your selected display time zone.
- Retain changes in browser localStorage; download a JSON backup or clear local data.
- Responsive navigation, accessible input labels, keyboard focus states, dialog focus containment, and reduced-motion support.

**This is a local demo, not a private pilot yet.** The first visit seeds fictional sample tasks and contacts. There is no AI parsing, recording, transcription, conversational context, authentication, cloud database, or notification delivery. Dates on tasks do not trigger notifications. Use sample information on shared devices: localStorage is neither user-isolated nor encrypted. Clearing browser storage removes the workspace. Exports currently provide a readable backup; import is not implemented.

## Run locally

Requires Node.js 20.9 or newer (Node 24 used in development).

```bash
cd /workspace/leadloop
npm ci
npm run dev
```

For a local computer, replace the directory with your cloned repository folder. Open the development server on port 3000 in your browser. No API keys or accounts are required for this milestone.

```bash
npm test           # task validation, correction without duplication, timezone display
npm run build     # production compilation and TypeScript validation
npm run start     # serve the production build
```

Browser tests exercise capture → confirm → save → refresh → edit → complete → delete, plus contact persistence, on desktop and mobile Chromium:

```bash
npx playwright install chromium
npm run build
npm run test:e2e
```

On this cloud machine, Chromium is already installed. Avoid the browser download and use:

```bash
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run build
npm run test:e2e
```

Task date entry explicitly uses the device’s time zone. The selected Settings zone controls date display and confirmation. Natural-language dates are not interpreted in Phase 1.

## Project map

- `app/page.tsx`: screens, editors, local persistence, capture/review workflow.
- `app/globals.css`: responsive design and Tailwind entry point.
- `lib/tasks.ts`: task model, sample data, save/update rules, timezone formatting.
- `tests/`: focused unit tests.
- `e2e/`: browser workflow tests.

## Next milestones

2. Add push-to-talk recording and server-side transcription. Use validated structured AI output, a short session history, exact timezone-aware dates, clarification for ambiguity, and approval before writes. Corrections must retain task identity. Delete temporary audio after transcription.
3. Add Supabase accounts and persistent tasks/contacts protected by row-level security; test that one user cannot access another user’s data. Migrate local data only with explicit consent.
4. Add an authenticated server-side scheduler and email provider. Use durable delivery records, atomic job claims, idempotency, retries, cancellation on completion/deletion, and monitoring. Never rely on an open browser or AI for scheduling.
5. Test timezone/DST boundaries, multiple-task extraction, conversation corrections, auth isolation, reminder failures/retries, microphone denial, and a complete private pilot. Local demo tests do not validate these unimplemented capabilities.

## Budget and services

Spent by this implementation: **$0**. Current local development has **$0 recurring service costs** and makes no AI or email API calls. No deployment or paid service was purchased.

Future pilot planning allowance (not a provider quote or purchase): $0–10/month hosting, $0–25/month database/auth depending on free-tier capacity and reliability needs, and a capped $5–15/month AI trial budget. Email pricing and scheduler frequency must be checked before selecting providers. A domain is optional. Verify current commercial-use terms, delivery quotas, and costs before enabling any service; keep the $500 budget intact until there is a reason to spend.

Never put secret keys in `NEXT_PUBLIC_*` variables or committed files. Future credentials belong in server-side hosting/environment settings, never chat. No secrets are required or consumed by this version.
