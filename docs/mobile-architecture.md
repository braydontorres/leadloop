# LeadLoop iPhone-first architecture (preparation)

The future Expo/React Native client will retain the current one-tap session:
explicit user tap → native microphone turn → server transcription/interpretation
→ deterministic shared domain transition → speech playback → next explicit or
hands-free turn. It will never use background microphone recording.

The app will authenticate through Supabase Auth and access only workspace-scoped
records. `lib/domain` supplies calendar, confirmation, customer, and quote
rules. Native platform dependencies live behind the contracts in
`mobile/src/platform/contracts.ts`:

- microphone capture and permission,
- text-to-speech playback,
- experimental Siri/App Intents/Shortcuts entry points,
- device token registration for a future server scheduler.

Siri and notifications are not implemented or represented as available. A later
milestone must choose supported Expo packages, obtain physical-device consent,
and add server-side notification scheduling with idempotency and audit logs.
