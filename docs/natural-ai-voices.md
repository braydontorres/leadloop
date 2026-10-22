# Natural AI voices

LeadLoop keeps the existing device speech engine as its default. Natural AI
voice is an explicit per-device opt-in in **Settings → Assistant voice**.
Enabling it displays a cost notice before the first server request. Turning it
off immediately returns replies to device speech.

## Supported implementation

The authenticated mobile app sends a short assistant reply, selected voice ID,
and pace to `POST /api/mobile/speech`. That route validates the caller's
Supabase JWT and workspace membership, limits text to 800 characters, applies a
per-user request limit, and asks OpenAI for a transient MP3. It returns
`Cache-Control: no-store`; neither the server nor Supabase stores the text or
audio. The iPhone holds the MP3 in its OS-managed cache only for playback and
deletes it when playback ends or is cancelled.

The server uses `gpt-4o-mini-tts`, MP3 output, and the documented voice IDs
`alloy`, `echo`, `fable`, `onyx`, `nova`, and `shimmer`. LeadLoop labels these
by delivery style, not biological gender. Consult OpenAI's current
[Text-to-Speech guide](https://platform.openai.com/docs/guides/text-to-speech)
and [pricing](https://platform.openai.com/docs/pricing) before enabling it in a
production environment; provider models, voices, pricing, and usage policies
can change.

## Cost control

OpenAI has published `gpt-4o-mini-tts` pricing around **$15 per million input
characters**. At that rate, a 150-character response is roughly **$0.00225**;
100 similarly sized replies are roughly **$0.23**. These are estimates, not a
billing promise. The owner should confirm the current OpenAI price and project
limits before enabling Natural AI voice.

No new environment variable is required when the existing Render service
already has `OPENAI_API_KEY` for transcription and interpretation. An optional
server-only `OPENAI_TTS_MODEL` can select a supported replacement model; it is
not exposed to the iPhone. Never use an `EXPO_PUBLIC_` OpenAI variable.

## Fallback and turn-taking

If natural speech configuration, authentication, synthesis, download, or
playback fails, LeadLoop speaks the same response through `expo-speech` and
preserves the conversation. The hands-free recorder resumes only after the
selected playback finishes. End Conversation invalidates the playback token,
stops both engines, deletes the temporary MP3, and prevents listening from
restarting.

Voice preferences are scoped to the signed-in user and selected workspace in
local device storage. The deployed `workspace_preferences` schema does not yet
contain voice fields, so this release deliberately does not pretend those
preferences synchronize across devices.
