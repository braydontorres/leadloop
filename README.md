# LeadLoop

**Just talk. We’ll remember.** A mobile-first workspace for small business owners.

## Current milestone: Phase 2

A functioning local prototype built with Next.js, TypeScript, Tailwind CSS, and Lucide icons. Includes Home, Capture & Review, Tasks, People, and Settings.

- Type a thought, review its details, and explicitly confirm before saving.
- Create, edit, complete, reopen, search, and delete tasks.
- Keep contact records and notes; associate a task with a person.
- Choose exact dates and times and see confirmation dates in your selected display time zone.
- Retain changes in browser localStorage; download a JSON backup or clear local data.
- Responsive navigation, accessible input labels, keyboard focus states, dialog focus containment, and reduced-motion support.
- Push-to-talk recording with an explicit start/stop action, duration indicator, cancellation, 90-second client limit, browser capability checks, and microphone-permission feedback.
- Server-side audio transcription and structured task understanding when `OPENAI_API_KEY` is configured. The browser never receives the key and raw audio is not written to disk.
- A bounded six-turn conversation context that lets the AI create, clarify, update, or propose cancellation of reviewable task changes. Every write and cancellation still requires confirmation.

When a task needs a follow-up, LeadLoop keeps a stable unfinished draft ID, its known fields, and the pending question. A later answer updates that same review card; corrections preserve unrelated fields. If several unfinished tasks could match a vague reply, the AI is instructed to ask which task the user means.

**This is still a local prototype, not a private pilot yet.** The first visit seeds fictional sample tasks and contacts. With no key, voice and AI controls enter a clearly labelled setup/demo state and the original manual review path stays available. There is no authentication, cloud database, or notification delivery. Dates on tasks do not trigger notifications. Use sample information on shared devices: localStorage is neither user-isolated nor encrypted. Clearing browser storage removes the workspace. Exports currently provide a readable backup; import is not implemented.

## Run locally

Requires Node.js 20.9 or newer (Node 24 used in development).

```bash
cd /workspace/leadloop
npm ci
npm run dev
```

For a local computer, replace the directory with your cloned repository folder. Open the development server on port 3000 in your browser.

### Enable real voice and AI

Create a private local environment file from the safe template, then enter your OpenAI key only on your machine:

```bash
cp .env.example .env.local
```

Set `OPENAI_API_KEY` in `.env.local`, restart `npm run dev`, and use Capture & Review. Keep the name exactly as written; do **not** use a `NEXT_PUBLIC_` prefix. `.env.local` is ignored by Git. The app sends short audio to OpenAI for transcription only after the user explicitly records and stops a note, then sends the transcript and a small session context for structured task extraction. It does not save raw audio locally or to the app server.

If the key is absent, the app reports that fact without making an OpenAI request. You can still type a task and select **Review manually instead**.

LeadLoop selects a recorder format with `MediaRecorder.isTypeSupported()`. It supports Chrome/Edge/Firefox WebM with Opus codec parameters and Safari MP4/M4A codec parameters, while the server keeps a strict allowlist for WebM, MP4/M4A, Ogg, MP3, and WAV. If your browser cannot produce one of those formats, LeadLoop explains the problem and keeps typed capture available.

```bash
npm test          # task, context, validation, timezone, and missing-key tests
npm run build     # production compilation and TypeScript validation
npm run start     # serve the production build
```

Browser tests exercise manual capture → confirm → save → refresh → edit → complete → delete, contact persistence, and microphone-denial feedback on desktop and mobile Chromium. They do not call OpenAI:

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

Task date entry uses the device’s time zone. The selected Settings zone controls date display and confirmation. For AI interpretation, LeadLoop supplies the current date, time, and selected zone to the model. If a reminder has a date without a time or another ambiguous detail, it should ask a clarification instead of creating a task.

## Project map

- `app/page.tsx`: screens, editors, local persistence, capture/review workflow.
- `app/api/voice/route.ts`: size-checked audio upload, server-side transcription, and task interpretation.
- `app/api/interpret/route.ts`: secure text interpretation endpoint.
- `lib/ai-server.ts`: OpenAI request handling, response-schema validation, bounded context, errors, and timeouts.
- `lib/conversation.ts`: shared AI contract and review-queue behavior.
- `app/globals.css`: responsive design and Tailwind entry point.
- `lib/tasks.ts`: task model, sample data, save/update rules, timezone formatting.
- `tests/`: focused unit tests.
- `e2e/`: browser workflow tests.

## Next milestones

3. Add Supabase accounts and persistent tasks/contacts protected by row-level security; test that one user cannot access another user’s data. Migrate local data only with explicit consent.
4. Add an authenticated server-side scheduler and email provider. Use durable delivery records, atomic job claims, idempotency, retries, cancellation on completion/deletion, and monitoring. Never rely on an open browser or AI for scheduling.
5. Test timezone/DST boundaries, multiple-task extraction, conversation corrections, auth isolation, reminder failures/retries, microphone denial, and a complete private pilot. Local demo tests do not validate these unimplemented capabilities.

## Budget and services

Spent by this implementation: **$0**. Current local development has no recurring service costs until an OpenAI key is configured. No deployment or paid service was purchased.

For a small pilot, `gpt-4o-mini-transcribe` and `gpt-4o-mini` are selected for low cost. A rough planning estimate is around $0.01–$0.03 for a one-minute recording plus one short interpretation, depending on current OpenAI pricing, audio duration, and token use. Set a low OpenAI project budget and usage alerts before testing with real customers. A capped $5–15/month AI trial budget remains sensible; confirm current provider pricing before spending.

Never put secret keys in `NEXT_PUBLIC_*` variables or committed files. Future credentials belong in server-side hosting/environment settings, never chat. No secrets are required or consumed by this version.

## Phase 3A.1 cloud foundation

The optional cloud foundation is available on `feat/cloud-foundation-phase-3a`.
It adds a Supabase schema, workspace RLS design, typed browser data-access
boundary, and an explicit non-destructive local import design. It does **not**
connect this local prototype to a live Supabase project automatically. See
[cloud setup and migration details](docs/cloud-foundation.md) and the
[iPhone/Expo architecture](docs/mobile-architecture.md).
