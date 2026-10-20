import assert from "node:assert/strict";
import { test } from "node:test";
import {
  advanceCustomerMemory,
  emptyCustomerMemoryState,
  findCustomer,
  saveCustomer,
} from "../lib/customer-memory";
import { migrateStore, persistStore, type Person } from "../lib/tasks";
import {
  advanceConversation,
  emptyConversationState,
  finishSpeech,
  type AssistantIntent,
} from "../lib/conversation-machine";

const now = new Date("2026-10-20T12:00:00.000Z");
let sequence = 0;
const id = () => `id-${++sequence}`;
const person = (name: string, overrides: Partial<Person> = {}): Person => ({
  id: id(),
  name,
  business: "",
  email: "",
  phone: "",
  address: "",
  notes: "",
  interactions: [],
  createdAt: now.toISOString(),
  updatedAt: now.toISOString(),
  ...overrides,
});
const step = (
  state: ReturnType<typeof emptyCustomerMemoryState>,
  text: string,
  people: Person[],
) => advanceCustomerMemory({ state, text, people, createId: id, now });

test("customer creation, notes, and updates require explicit confirmation", () => {
  const proposed = step(
    emptyCustomerMemoryState(),
    "Remember that Mike wants his driveway cleaned for $250.",
    [],
  );
  assert.equal(proposed.handled, true);
  assert.equal(proposed.savedPerson, undefined);
  assert.equal(proposed.state.pending?.person.name, "Mike");
  assert.match(proposed.reply, /Is that correct/);

  const corrected = step(
    proposed.state,
    "His phone number is 555-010-1234.",
    [],
  );
  assert.equal(corrected.state.pending?.person.phone, "555-010-1234");
  const saved = step(corrected.state, "Yes", []);
  assert.equal(saved.savedPerson?.name, "Mike");
  assert.equal(saved.savedPerson?.phone, "555-010-1234");
  assert.equal(saved.savedPerson?.interactions.length, 1);
  assert.equal(step(saved.state, "Yes", [saved.savedPerson!]).handled, false);
});

test("existing customers receive notes without duplicate profiles and retrieval uses stored facts", () => {
  const mike = person("Mike", { notes: "Quoted $250." });
  const proposed = step(
    emptyCustomerMemoryState(),
    "Mike said he needs to talk to his wife before accepting the quote.",
    [mike],
  );
  assert.equal(proposed.state.pending?.operation, "note");
  const saved = step(proposed.state, "correct", [mike]);
  const people = saveCustomer([mike], saved.savedPerson!);
  assert.equal(people.length, 1);
  const recalled = step(saved.state, "What do I know about Mike?", people);
  assert.match(recalled.reply, /Quoted \$250/);
  assert.match(recalled.reply, /wife before accepting/);
});

test("customer retrieval never leaks another customer's notes", () => {
  const mike = person("Mike", { notes: "Driveway quote is $250." });
  const sarah = person("Sarah", { notes: "Prefers an afternoon call." });
  const recalled = step(
    emptyCustomerMemoryState(),
    "What do I know about Sarah?",
    [mike, sarah],
  );
  assert.match(recalled.reply, /afternoon call/);
  assert.doesNotMatch(recalled.reply, /Driveway quote/);
});

test("consecutive confirmed customer conversations do not retain the prior pending record", () => {
  const mikeDraft = step(
    emptyCustomerMemoryState(),
    "Remember that Mike wants an estimate.",
    [],
  );
  const mikeSaved = step(mikeDraft.state, "Yes", []);
  const sarahDraft = step(
    mikeSaved.state,
    "Remember that Sarah needs an afternoon call.",
    [mikeSaved.savedPerson!],
  );
  assert.equal(sarahDraft.state.pending?.person.name, "Sarah");
  assert.notEqual(
    sarahDraft.state.pending?.person.id,
    mikeSaved.savedPerson?.id,
  );
  const sarahSaved = step(sarahDraft.state, "Yes", [mikeSaved.savedPerson!]);
  const people = saveCustomer(
    [mikeSaved.savedPerson!],
    sarahSaved.savedPerson!,
  );
  assert.deepEqual(
    people.map((entry) => entry.name),
    ["Mike", "Sarah"],
  );
});

test("updates, missing customers, ambiguity, and cancellation are explicit", () => {
  const mike = person("Mike Rogers");
  const update = step(
    emptyCustomerMemoryState(),
    "Update Mike Rogers's information. His email is mike@example.com.",
    [mike],
  );
  assert.equal(update.state.pending?.person.email, "mike@example.com");
  const canceled = step(update.state, "Cancel", [mike]);
  assert.equal(canceled.state.pending, null);
  assert.equal(
    step(canceled.state, "What do I know about Terry?", [mike]).reply,
    "I don’t have any information for Terry yet.",
  );
  const ambiguous = step(
    emptyCustomerMemoryState(),
    "What do I know about Mike?",
    [mike, person("Mike Davis")],
  );
  assert.match(ambiguous.reply, /more than one customer/);

  const renamed = step(
    emptyCustomerMemoryState(),
    "Update Mike Rogers's information. His preferred name is Michael Rogers.",
    [mike],
  );
  assert.equal(renamed.state.pending?.person.id, mike.id);
  assert.equal(renamed.state.pending?.person.name, "Michael Rogers");
});

test("legacy local records migrate without losing reminders or people", () => {
  const migrated = migrateStore(
    {
      name: "Owner",
      business: "Demo",
      timezone: "America/Chicago",
      workingDays: [1, 2, 3, 4, 5],
      tasks: [
        {
          id: "task-1",
          title: "Call Mike",
          person: "Mike",
          due: "2026-10-20T20:00:00.000Z",
          completed: false,
          notes: "Existing task",
        },
      ],
      people: [
        {
          id: "person-1",
          name: "Mike",
          business: "",
          email: "",
          notes: "Old note",
        },
      ],
    },
    now.toISOString(),
  );
  assert.equal(migrated.tasks[0].id, "task-1");
  assert.equal(migrated.tasks[0].personId, undefined);
  assert.equal(migrated.people[0].id, "person-1");
  assert.equal(migrated.people[0].notes, "Old note");
  assert.equal(migrated.people[0].phone, "");
  assert.equal(migrated.people[0].interactions.length, 0);
});

test("storage failures leave the caller able to retain a pending customer change", () => {
  const store = migrateStore(
    {
      name: "Owner",
      business: "",
      timezone: "America/Chicago",
      workingDays: [1, 2, 3, 4, 5],
      tasks: [],
      people: [],
    },
    now.toISOString(),
  );
  assert.equal(
    persistStore(
      {
        setItem: () => {
          throw new Error("quota");
        },
      } as Pick<Storage, "setItem">,
      store,
    ),
    false,
  );
});

test("customer-linked reminders retain their calendar correction and stable task id", () => {
  const mike = person("Mike");
  const fields: AssistantIntent["fields"] = {
    title: "call Mike about the driveway estimate",
    person: "Mike",
    date: null,
    time: null,
    notes: "",
    clearDue: false,
  };
  const first = advanceConversation({
    state: emptyConversationState(),
    result: { intent: { kind: "new_task", fields } },
    text: "Remind me to call Mike next Friday at 3 PM about his driveway estimate.",
    timeZone: "America/Chicago",
    now,
    createId: () => "reminder-1",
  });
  const correction = advanceConversation({
    state: finishSpeech(first.state),
    result: {
      intent: {
        kind: "update",
        fields: { ...fields, title: null, person: null },
      },
    },
    text: "Actually, make it 4 PM.",
    timeZone: "America/Chicago",
    now,
    createId: id,
  });
  const saved = advanceConversation({
    state: finishSpeech(correction.state),
    result: {
      intent: {
        kind: "confirm",
        fields: { ...fields, title: null, person: null },
      },
    },
    text: "Yes.",
    timeZone: "America/Chicago",
    now,
    createId: id,
  });
  assert.equal(saved.savedTask?.id, "reminder-1");
  assert.equal(findCustomer([mike], saved.savedTask?.person ?? "").kind, "one");
  assert.match(saved.savedTask?.due ?? "", /T21:00:00.000Z/);
});
