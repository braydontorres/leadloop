# LeadLoop iPhone MVP

This is the Expo SDK 57 / React Native client for LeadLoop. It uses the same Supabase
project, workspace membership, customers, and task tables as the Next.js app.
The publishable Supabase key is protected by the existing database RLS rules;
this app never contains a service-role or OpenAI key.

## What works in Phase 3C

- Email/password sign-in and encrypted native session persistence via
  `expo-secure-store`.
- Per-account restoration of the last authorized workspace. If there is only
  one workspace, LeadLoop selects it automatically.
- Cloud-backed customer and open-reminder lists.
- Creation and completion of reminders directly in the existing `tasks` table.
  Reminder IDs and optional customer IDs are preserved.
- A native `expo-audio` tap-to-talk recorder with iOS microphone permission.
  Recording begins only after an explicit tap and stops after a second tap.
- Authenticated voice upload to `POST /api/mobile/voice`. The app attaches the
  signed-in user's Supabase access token; the server verifies the token and
  workspace membership with RLS before it transcribes a supported iOS MPEG-4
  recording. The route never uses a service-role key and stores no raw audio.
- The server reuses LeadLoop's existing OpenAI transcription, structured
  interpretation, and deterministic calendar conversation machine. The phone
  displays the transcript, speaks LeadLoop's response when iOS speech is
  available, reads a complete reminder back, and writes only after an explicit
  voice or **Yes, save it** confirmation.
- Hands-free turns use a monotonic JavaScript clock for speech and silence
  timing, so a frozen iOS `durationMillis` cannot leave Capture permanently in
  **Listening**. Native recorder status remains a health and upload-metadata
  source. If iOS supplies no changing microphone levels, Capture stops that
  turn with a clear recovery message instead of guessing; manual recording is
  available under **Voice troubleshooting**.

Voice processing needs a trusted HTTPS Next.js server with the existing
`OPENAI_API_KEY`, plus the public Supabase URL and publishable/anon key in its
server environment. Do not put any of those private server values in
`mobile/.env`. The mobile voice base URL is public configuration, not a secret.
An iPhone cannot use `localhost` to reach the Mac. For local testing, expose
the Mac's Next.js server through a trusted HTTPS tunnel and set
`EXPO_PUBLIC_LEADLOOP_VOICE_API_URL` to that tunnel URL before starting Expo.

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
   git switch feat/iphone-ai-voice-phase-3c
   git pull --ff-only origin feat/iphone-ai-voice-phase-3c
   # Terminal 1: from ~/leadloop, with existing .env.local configured
   npm run dev
   # Terminal 2: expose port 3000 using your approved HTTPS tunnel provider
   # and set its resulting https:// URL in mobile/.env
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
   Open **Settings → Build information** and confirm the JavaScript commit
   matches `git rev-parse --short HEAD`. This identifies the Expo JavaScript
   bundle separately from the installed Expo Go runtime. Use **Share build
   information** when reporting a device result.
5. On **Capture**, tap the microphone to start one conversation. Speak one sentence, then
   pause for about 1–1.5 seconds. Capture should progress through **User
   Speaking**, **Processing**, and **Assistant Speaking**, then return to
   **Listening**. Development diagnostics should show the turn clock advancing
   even if native duration remains 0 ms. If the meter does not change, Capture
   will show an automatic-detection error; use **Voice troubleshooting** for
   the manual fallback and retain the diagnostics. When LeadLoop reads the full reminder back, say “Yes” or
   tap **Yes, save it**. Verify the reminder appears in Today after cloud
   persistence returns.

Expo Go supporting SDK 57 is compatible with the tap-to-talk MVP. Hands-free
still requires physical-device verification because Expo Go recorder metering
can vary by iOS/runtime version; this repository does not yet claim an
AVAudioEngine development-build VAD. Native speech playback uses `expo-speech`;
Siri/App Intents, background listening, push notifications, offline write
queues, and physical-device automated tests remain later work.

## Verification

```bash
cd ~/leadloop/mobile
npm run typecheck
npm test
```

These tests validate the deterministic helpers and configuration. They do not
prove a hosted OpenAI request, an HTTPS tunnel, or physical iPhone microphone
behavior. Test a real account, workspace, task, and microphone on a physical
iPhone before relying on the app in daily work.
