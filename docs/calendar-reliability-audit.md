# Calendar reliability audit

`npm run test:calendar:comprehensive` is the permanent fast regression gate for
the currently supported calendar and conversation behavior. It runs without an
OpenAI request. Its route layer uses a fixed mocked provider response, and its
calendar and conversation layers are deterministic.

## Layers and coverage

- **Calendar mathematics:** a 20-year, 12-month, 7-weekday, 7-occurrence
  matrix covers 11,760 ordinal combinations. A separate test oracle enumerates
  every day in a month instead of reusing the resolver's first-weekday formula.
  It verifies first through fifth, last, and second-to-last, including invalid
  fifth occurrences.
- **Implicit years:** five frozen reference dates exercise every
  month/weekday/ordinal combination (2,940 cases), including earlier and later
  months, current-month passed occurrences, December-to-January transitions,
  and explicit past years.
- **Language and time extraction:** the supported relative-date phrases, all
  seven `next weekday` forms, ISO dates, every 1–12 AM/PM hour at three minute
  values, noon, midnight, and ambiguous clock forms are checked. The suite
  verifies that ordinal wording is not mistaken for a time.
- **Conversation state:** generated ordinal conversations cover all 588
  month/weekday/occurrence combinations and rotate through `none`, `confirm`,
  `new_task`, `follow_up`, and `update` labels. A 100-session state simulation
  covers confirmations, cancellations, corrections, conversation endings, and
  fresh drafts.
- **Route integration:** `/api/interpret` is called with mocked provider
  responses to verify parsing and state transitions together. It never calls a
  paid provider.
- **Browser integration:** `npm run test:e2e` retains representative desktop
  and mobile flows for typed input, mocked microphone capture, speech playback,
  and consecutive sessions. These are simulations, not physical-microphone
  tests.

## Supported scope

The audit covers the Phase B one-time reminder subset: exact dates, the
documented relative-day/week/month phrases, ordinal weekdays, local times, and
the configured IANA time zone. A missing year follows the next-upcoming policy
from the draft's captured reference instant. Missing times and AM/PM ambiguity
remain clarifications; LeadLoop never supplies a default time.

Recurring rules, holidays, business-day rules, ranges, regional calendars, and
user-selectable fall-back DST occurrences remain outside Phase B. Spring DST
gaps are rejected. Fall-back local times are round-tripped deterministically by
the current converter; explicit user choice for the repeated occurrence belongs
to Phase D.

## Audit findings and fixes

The audit found that `deterministicDateFromText` matched `tomorrow` inside
`day after tomorrow` when used directly. The shared helper now checks the
longer phrase first, so it agrees with the central `CalendarExpression`
relative-date parser. The regression is in the comprehensive suite.

The audit is intentionally additive: it does not alter saved tasks, local
storage, task IDs, voice capture, or the confirmation-before-saving boundary.
