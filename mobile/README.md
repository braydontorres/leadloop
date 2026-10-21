# LeadLoop iPhone MVP

This is the Expo/React Native client for LeadLoop. It uses the same Supabase
project, workspace membership, customers, and task tables as the Next.js app.
The publishable Supabase key is protected by the existing database RLS rules;
this app never contains a service-role or OpenAI key.

## What works in Phase 3B

- Email/password sign-in and encrypted native session persistence via
  `expo-secure-store`.
- Per-account restoration of the last authorized workspace. If there is only
  one workspace, LeadLoop selects it automatically.
- Cloud-backed customer and open-reminder lists.
- Creation and completion of reminders directly in the existing `tasks` table.
  Reminder IDs and optional customer IDs are preserved.
- A native `expo-audio` tap-to-talk recorder with iOS microphone permission.
  Recording begins only after an explicit tap and stops after a second tap.

The recorder is real, but this milestone deliberately does **not** upload or
transcribe audio. The web `/api/voice` route is not an authenticated mobile
speech endpoint, and OpenAI credentials must remain server-side. After a
recording the app clearly offers the typed reminder sheet. Server-mediated
transcription is the next mobile voice milestone.

The app imports deterministic task/date helpers from `../lib/tasks` through
Metro's workspace watch folder. Calendar conversation, customer memory, quote
editing, Siri, push notifications, and offline write queues remain web or
future-milestone work; the mobile app does not claim those features work.

## Run on an iPhone with Expo Go

1. On the Mac, copy the public values from the existing web `.env.local` into
   `mobile/.env` using `mobile/.env.example`. Use only the project URL and
   publishable/anon key.
2. From the repository root:

   ```bash
   cd ~/leadloop
   git fetch origin
   git switch feat/iphone-mvp-phase-3b
   git pull --ff-only origin feat/iphone-mvp-phase-3b
   cd mobile
   npm install
   npx expo start --tunnel
   ```

3. Install **Expo Go** from the iPhone App Store. Scan the terminal QR code
   with the iPhone Camera and choose Expo Go. `--tunnel` works when the phone
   and Mac are not on the same Wi-Fi network; use `npx expo start --lan` when
   they are on the same trusted network.
4. Sign in with the same account used on the web. The app restores a selected
   workspace or asks you to choose an authorized one.
5. On **Capture**, tap **Tap to talk**, grant microphone permission, speak,
   and tap **Stop**. This confirms native capture; it does not yet transcribe
   the recording. Use **Create a typed reminder** to persist a reminder.

Expo Go is compatible with this MVP. A custom development build is only needed
when adding native transcription, Siri/App Intents, or notification modules.

## Verification

```bash
cd ~/leadloop/mobile
npm run typecheck
npm test
```

These tests cover public mobile Supabase configuration and account-scoped
workspace keys. They mock neither real Supabase nor iPhone hardware. Test a
real account, workspace, task, and microphone on a physical iPhone before
relying on the app in daily work.
