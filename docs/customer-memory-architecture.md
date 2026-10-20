# Customer memory architecture — Phase 1

Customer memory extends the existing browser-local `Store`; it does not introduce a second customer database or alter `CalendarExpression`.

## Boundaries

- `lib/customer-memory.ts` owns customer lookup, migration-safe record updates, deterministic wording recognition, pending write confirmation, and fact-only retrieval.
- `lib/tasks.ts` owns the persisted `Person`, `Task`, and `Store` shapes. Legacy people and reminders are normalized without changing their IDs or scheduled instants.
- `lib/conversation-machine.ts` remains the authoritative reminder and calendar state machine. Customer memory never parses, resolves, or changes dates.
- `app/page.tsx` coordinates the two flows. A customer-memory request is handled locally; a reminder can be linked to one already-resolved customer ID when it is saved.

## Privacy and persistence

Customer records remain in `leadloop.phase1.v1` in the current browser. During migration, the unmodified previous JSON is copied to `leadloop.phase1.v1.backup.v1` when no such backup exists. Settings retains the JSON export control. The browser sends neither the people array nor customer notes, addresses, phone numbers, or email addresses to the interpretation API.

## Customer operations

The customer state machine distinguishes retrieval from pending writes. Create, profile updates, and interaction notes are read back and require an explicit yes before they change the store. Retrieval uses only stored facts. Name lookup returns a single exact/unique partial match, reports no match, or asks the owner to distinguish multiple matching people. Existing names add a note rather than silently making a duplicate profile.

## Customer-linked reminders

Tasks now optionally carry `personId`. Existing `person` strings remain valid. On confirmation, a reminder with an unambiguous stored person is saved with both its legacy display name and the stable customer ID. If the name resolves to more than one person, LeadLoop keeps the reminder pending and asks for clarification; it never guesses a customer ID.
