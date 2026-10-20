# Calendar expression architecture (Phases B and C)

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

## Reliability repair: relative corrections and state synchronization

The Phase B follow-up repair supports a deliberately small, deterministic
relative-date subset: `tomorrow`, `the day after tomorrow`, `in five days`,
`three days from now`, `two weeks from today`, `one week later`, and `two months
from now`. These expressions are represented in `CalendarExpression`, not in a
separate UI parser. `from today` and `from now` use the draft's captured
reference instant in the configured IANA time zone, so a conversation does not
drift across processing delays. `later` uses the existing reminder's local date.
Date-only changes keep the existing local clock time. Month arithmetic clamps to
the final day of the target month (for example, January 31 plus one month is
February 28 or 29).

An explicit deterministic schedule change now takes priority over an AI
`confirm` or `none` label during read-back. The conversation returns to
read-back with the recalculated schedule and requires a fresh confirmation. An
unrecognized correction enters clarification instead, so `Yes` cannot silently
save the stale schedule.

The browser logs anonymous session/turn IDs, stage transitions, and resolver
outcomes for accepted or discarded turns. It does not log transcripts, audio,
API keys, titles, contacts, or calendar values.

The initial time zone comes from the browser for a new local store and is saved
with that store. Settings exposes the selected IANA zone, including
`America/Chicago` for Midland, Texas. That same selected zone controls parsing,
read-back, display, and conversion to the stored UTC instant. Changing the
setting does not rewrite existing saved instants.

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

## Implicit-year policy

For a month/weekday expression without an explicit year, the resolver selects
that month’s next upcoming occurrence from the captured local reference date.
Past months use the following year; future months use the current year. For the
current month, a selected ordinal that has already passed (including its stated
local time) uses the following year. Explicit years are never changed; an
explicit past schedule is rejected for clarification. A nonexistent fifth
weekday remains invalid rather than moving to another month or year.

## Phase C natural-language scheduling

Phase C keeps `CalendarExpression` as the only mutable scheduling state. The
shared `calendarLanguageFieldsFromText` parser produces deterministic date,
time, or relative-expression updates before `advanceConversation` merges them
into the active draft. Typed and spoken transcripts therefore take the same
path.

Supported relative language includes today, tomorrow, day after tomorrow, this
or next weekday, weekday-after-next, calendar offsets in days/weeks/months/years,
offsets from an established reminder, a week from tomorrow, offsets from next
weekday, and offsets from a stated calendar date. Month and year arithmetic is
calendar-aware and clamps only overflowing month-end days.

The convention is fixed: **this Friday** is the Friday in the current local
calendar week, including today; **next Friday** is the first Friday strictly
after the captured local reference date; **Friday after next** is the following
Friday. On a Monday, both “this Friday” and “next Friday” are that week’s
Friday; “Friday after next” is the Friday one week later.

Spoken clocks support noon, midnight, `half past`, `quarter past`, `quarter
to`, and word-based `three fifteen`/`three thirty` forms when AM or PM is
spoken. A clock without AM/PM stays unanswered and the conversation asks for a
time. Minute/hour durations use the completed reminder's instant when one is
already established; otherwise they use the draft's frozen reference instant.

The local workspace persists `workingDays`, defaulting to Monday through Friday.
It is a Phase C preference for future working-day language and does not move
ordinary weekend reminders. Holiday, recurrence, and explicit fall-back DST
selection remain outside this phase.
