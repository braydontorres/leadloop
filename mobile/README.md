# LeadLoop native-client foundation

This folder is intentionally **not** an Expo application yet. Phase 3A.1 keeps
working web and calendar behavior unchanged while defining the native boundary.

A future Expo client will import the framework-independent rules from
`lib/domain`, call the authenticated workspace repository, and provide these
platform adapters:

- `NativeMicrophone`: explicit tap-to-talk capture only; no background recording.
- `NativeSpeechPlayback`: the spoken drive-through replies.
- `ShortcutIntentBridge`: an isolated Siri/App Intents adapter. Expo support is
  experimental, so no business rule should depend on it.
- `DeviceNotificationRegistration`: token registration only; actual reminder
  delivery is a later server-side milestone.

Before adding Expo, create a separate `mobile/package.json` and keep native
secrets out of it. The Supabase **anon** key may be configured by the app;
service-role and OpenAI keys must remain on trusted servers.
