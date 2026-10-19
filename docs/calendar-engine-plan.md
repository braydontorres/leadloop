# LeadLoop calendar-engine roadmap

## Phase A: ordinal weekday repair

Completed on `fix/calendar-engine-phase-a`. The shared conversation state retains a
partial year/month/weekday constraint. An ordinal follow-up is merged into that
constraint, then deterministic Gregorian calendar code resolves the concrete local
date. AI output cannot select the final ordinal date. If an occurrence does not
exist, the state remains incomplete and LeadLoop asks for a different occurrence.

## Phase B: calendar domain model (immediate MVP)

Create a `CalendarExpression` model separate from reminder UI state. It should carry
the user-supplied constraints and their certainty rather than a prematurely chosen
timestamp:

- one-time absolute, relative, partial, month, weekday, ordinal, local-time, and
  IANA-zone constraints;
- offsets and date ranges;
- recurrence rules, end conditions, and exception dates;
- unresolved fields, ambiguity reasons, and correction target metadata.

Keep the existing deterministic Gregorian helpers for month/weekday calculations;
they are smaller, auditable, and need no dependency. Add `@js-temporal/polyfill`
when named zones, daylight-saving gaps, and ambiguous local times are implemented.
Use it to resolve a local date/time exactly once at read-back time.

AI remains an extractor into this model. The application validates every field and
chooses reminders, task IDs, questions, confirmation, and persistence.

## Phase C: common date and time language (next MVP milestones)

1. Add deterministic parsing for today/tomorrow/day-after-tomorrow, this/next
   weekday, Friday-after-next, relative day/week/month/year offsets, and offsets
   from an already resolved date.
2. Add explicit clock forms: noon, midnight, half-past, quarter-to, and durations
   such as ninety minutes. Do not infer a missing time.
3. Add a clear documented convention for phrases such as “next Friday”; ask when
   context or wording remains ambiguous.
4. Store the reference instant used to resolve relative language, so reminders do
   not drift while a conversation is in progress.
5. Add a user setting for working days; do not interpret holidays until region is
   selected.

## Phase D: recurrence, holidays, and exceptions (advanced)

Represent recurrence independently from a one-time due instant. Evaluate the
well-maintained `rrule` package for RFC-style daily, weekly, monthly, yearly,
interval, count, until, and exception handling. Before adding it, verify its time
zone behavior against Temporal and keep local-zone resolution in LeadLoop.

Add recurrence summaries and preview occurrences before confirmation. Model “this
one” versus “all future occurrences” explicitly. Add holiday support only after a
region is selected; use a maintained regional holiday-data package or service behind
a small adapter, and state when a region or holiday rule is unavailable.

## Phase E: quality gates

Add table-driven coverage over every month, weekday, ordinal, leap year, and
four-versus-five-occurrence combination. Add property tests for calendar invariants
(resolved date is in the requested month, has the requested weekday, and has the
requested ordinal). Add Temporal/DST tests for gaps and repeated local times.

Add conversation integration tests for missing fields, corrections, ambiguous
references, multi-reminder separation, recurrence previews, and failures that must
preserve the active draft. Continue using mocked AI for deterministic tests. Keep a
small, explicitly invoked live API contract check; it must use a configured key,
make a fixed low number of requests, and never include private reminder text.
