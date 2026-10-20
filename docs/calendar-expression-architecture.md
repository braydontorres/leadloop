# Calendar expression architecture (Phase B)

## Why this changed

The original conversation state split one reminder's schedule among `due`,
`pendingDate`, `pendingTime`, and `pendingDateConstraint`. Parsing helpers in
`reminder-details.ts` directly changed those fields in `advanceConversation`.
That made the screen, API context, and date parser each capable of treating the
same partial date differently. In particular, an ordinal answer could resolve a
calendar day while an older pending constraint still made the UI repeat its
question.

The retired multi-card implementation in `lib/conversation.ts` is separate from
the active drive-through flow. Phase B does not revive or extend it.

## Modules and responsibilities

- `lib/calendar-expression.ts` owns the typed `CalendarExpression`, its safe
  legacy adapter, merge operation, compatibility projection, and deterministic
  resolver.
- `lib/reminder-details.ts` remains the proven Gregorian and lightweight input
  extraction utility. It does not decide conversation stages.
- `lib/conversation-machine.ts` owns the active draft ID, dialogue state,
  clarification priority, task fields, confirmation, and persistence boundary.
- `/api/interpret` and `/api/voice` provide structured intent and a transcript.
  Both enter `advanceConversation`, so speech and typed input follow the same
  calendar path.
- `lib/tasks.ts` continues to store the existing final `Task` shape. No local
  storage keys or saved tasks are changed.

`CalendarExpression` is the canonical draft schedule. The older pending fields
are now a derived compatibility projection for the current UI and API context;
they must not be mutated as an independent source of truth.

## Phase B behavior

The resolver returns one explicit outcome: `resolved`, `incomplete`,
`ambiguous`, `invalid`, or `unsupported`. It supports one-time exact dates,
relative dates already deterministically parsed by the existing input utility,
local times, and month/year/weekday/ordinal constraints. It calculates ordinal
weekdays with Gregorian calendar math and validates the user-selected IANA time
zone before producing a UTC task instant.

When a user replies to an active calendar question, deterministic calendar
fields take precedence over the model's broad intent label. A single reply can
merge an ordinal weekday and a time. A resolved ordinal remains as context for
corrections while its exact date is presented to the existing UI, preventing a
repeated clarification.

## Intentional Phase B boundaries

The model also reserves typed fields for relative offsets, date ranges,
recurrence, exceptions, ambiguity, and correction targets. The resolver returns
`unsupported` for those advanced fields rather than guessing. Phase C should
add parsers for broader relative language and recurrences; Phase D should add
explicit DST-disambiguation and regional holiday policy; Phase E should expand
property and provider-contract coverage. No recurrence, holiday, subscription,
or notification behavior was added in Phase B.

## Compatibility and rollback

Existing saved tasks remain in `leadloop.phase1.v1` unchanged. When an old
in-memory conversation context lacks a calendar expression, `calendarFromLegacy`
creates one from its existing final or pending fields. Removing the new
expression from an in-progress context leaves the old compatibility fields
usable by the prior version, so no destructive local-data migration is needed.
