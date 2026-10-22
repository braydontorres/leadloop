# iPhone parity plan

## Audit at the Phase 3C baseline

| Web capability                                                                                       | Native baseline                    | Milestone        |
| ---------------------------------------------------------------------------------------------------- | ---------------------------------- | ---------------- |
| Home dashboard: today, horizon, counts, overdue activity                                             | Today list only                    | 1                |
| Capture: authenticated recording, transcription, deterministic reminder confirmation, typed fallback | Implemented; no hands-free VAD     | Preserve, then 3 |
| Tasks: filters, search, create, edit, complete, delete                                               | Create and complete only           | 1                |
| People: profiles, notes, quotes, linked reminders                                                    | Read-only summary cards            | 2                |
| Settings: account, workspace, business preferences, time zone, working days                          | Sign-out and workspace picker only | 2                |
| Natural selectable OpenAI speech                                                                     | Device `expo-speech` only          | 3                |

## Shared data boundary

The native app reads the same RLS-protected `tasks`, `customers`, `quotes`,
`customer_interactions`, `workspace_preferences`, and `workspaces` tables as
the website. Calendar expressions, task IDs, customer links, quote links, and
confirmation-before-save remain in shared TypeScript modules. Native UI must
not write a second local data model.

## Delivery milestones

1. **Native task and dashboard parity:** five-section navigation; cloud-backed
   Home and Tasks, including search, filters, create/edit/complete/delete;
   preserve the current Capture and People workflows.
2. **Customer and settings parity:** editable customer profile facts and notes,
   quote list/status actions, linked-reminder navigation, workspace/account
   controls, business name, time zone, and working days.
3. **Voice experience parity:** native turn-taking improvements and an optional
   hosted OpenAI TTS route. The app retains device speech as the no-cost
   fallback.

## Hosted voice decision

OpenAI TTS must be opt-in. It would add a paid server request for every spoken
assistant reply, requires a Render endpoint with the existing authenticated
workspace authorization, and may be affected by network latency. iOS system
voices remain available at no additional API cost and work when the hosted
voice request fails. A later preference will offer curated voice choices and
normal/relaxed/fast rates after the owner approves enabling paid speech.

This plan does not claim Siri, background listening, push notifications,
offline write queues, or recurring reminders are available.
