import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyAssistantIntent,
  emptyConversationState,
  type AssistantIntent,
} from "../lib/conversation-machine";
import { normalizeIsoInstant } from "../lib/conversation";
import type { Task } from "../lib/tasks";

const chicago = "America/Chicago";
const noFields: AssistantIntent["fields"] = {
  title: null,
  person: null,
  date: null,
  time: null,
  notes: null,
  clearDue: false,
};

function next(
  state = emptyConversationState(),
  intent: AssistantIntent,
  text: string,
  savedTasks: Task[] = [],
) {
  let counter = 0;
  return applyAssistantIntent({
    state,
    savedTasks,
    result: { message: intent.question ?? "Understood.", intent },
    text,
    timeZone: chicago,
    createId: () => `draft-${++counter}-${state.drafts.length}`,
  });
}

test("Scenario A: one Bill draft moves from due clarification to tomorrow at 3 PM", () => {
  const initial = next(
    undefined,
    {
      kind: "new_task",
      subject: "Bill",
      fields: {
        ...noFields,
        title: "Talk to Bill about washing his clothes",
        person: "Bill",
      },
      clarificationField: "due",
      question: "When would you like to set this reminder?",
    },
    "I need to talk to Bill about washing his clothes.",
  );
  assert.equal(initial.phase, "awaiting_clarification");
  assert.equal(initial.drafts.length, 1);
  const completed = next(
    initial,
    {
      kind: "follow_up",
      subject: null,
      fields: { ...noFields, date: "2026-10-19", time: "15:00" },
      clarificationField: null,
      question: null,
    },
    "Tomorrow at 3 PM.",
  );
  assert.equal(completed.drafts.length, 1);
  assert.equal(completed.drafts[0].id, initial.drafts[0].id);
  assert.equal(completed.drafts[0].due, "2026-10-19T20:00:00.000Z");
  assert.equal(completed.pending.length, 0);
  assert.equal(completed.phase, "ready_for_review");
});

test("Scenario B: correction updates the same Bill draft", () => {
  const bill = next(
    undefined,
    {
      kind: "new_task",
      subject: "Bill",
      fields: {
        ...noFields,
        title: "Talk to Bill about washing his clothes",
        person: "Bill",
        date: "2026-10-19",
        time: "15:00",
      },
      clarificationField: null,
      question: null,
    },
    "Talk to Bill tomorrow at 3 PM.",
  );
  const corrected = next(
    bill,
    {
      kind: "update",
      subject: "Bill",
      fields: { ...noFields, time: "17:00" },
      clarificationField: null,
      question: null,
    },
    "Actually, make it 5 PM.",
  );
  assert.equal(corrected.drafts.length, 1);
  assert.equal(corrected.drafts[0].id, bill.drafts[0].id);
  assert.equal(corrected.drafts[0].due, "2026-10-19T22:00:00.000Z");
});

test("Scenarios C and D: Sarah is separate and leaves Bill unchanged", () => {
  const bill = next(
    undefined,
    {
      kind: "new_task",
      subject: "Bill",
      fields: {
        ...noFields,
        title: "Talk to Bill",
        person: "Bill",
        date: "2026-10-19",
        time: "15:00",
      },
      clarificationField: null,
      question: null,
    },
    "Talk to Bill tomorrow at 3 PM.",
  );
  const withSarah = next(
    bill,
    {
      kind: "new_task",
      subject: "Sarah",
      fields: {
        ...noFields,
        title: "Call Sarah",
        person: "Sarah",
        date: "2026-10-19",
        time: "09:00",
      },
      clarificationField: null,
      question: null,
    },
    "Remind me to call Sarah tomorrow at 9 AM.",
  );
  assert.equal(withSarah.drafts.length, 2);
  const changed = next(
    withSarah,
    {
      kind: "update",
      subject: "Sarah",
      fields: { ...noFields, time: "18:00" },
      clarificationField: null,
      question: null,
    },
    "Change Sarah's reminder to 6 PM.",
  );
  const billAfter = changed.drafts.find((draft) => draft.person === "Bill")!;
  const sarahAfter = changed.drafts.find((draft) => draft.person === "Sarah")!;
  assert.equal(billAfter.due, "2026-10-19T20:00:00.000Z");
  assert.equal(sarahAfter.due, "2026-10-19T23:00:00.000Z");
});

test("ambiguous contacts ask which task instead of guessing", () => {
  const saved: Task[] = [
    {
      id: "s1",
      title: "Call Sarah",
      person: "Sarah",
      due: "",
      notes: "",
      completed: false,
    },
    {
      id: "s2",
      title: "Email Sarah",
      person: "Sarah",
      due: "",
      notes: "",
      completed: false,
    },
  ];
  const state = next(
    undefined,
    {
      kind: "update",
      subject: "Sarah",
      fields: { ...noFields, time: "18:00" },
      clarificationField: null,
      question: null,
    },
    "Change Sarah to 6 PM.",
    saved,
  );
  assert.equal(state.drafts.length, 0);
  assert.equal(state.pending[0].field, "task_choice");
  assert.deepEqual(state.pending[0].taskIds, ["s1", "s2"]);
});

test("twenty consecutive turns remain idempotent and retain stable draft counts", () => {
  let state = emptyConversationState();
  for (let index = 0; index < 20; index += 1) {
    state = next(
      state,
      {
        kind: index % 5 === 0 ? "new_task" : "update",
        subject:
          index % 5 === 0 ? `Person ${index}` : `Person ${index - (index % 5)}`,
        fields:
          index % 5 === 0
            ? {
                ...noFields,
                title: `Task ${index}`,
                person: `Person ${index}`,
                date: "2026-11-01",
                time: "09:00",
              }
            : {
                ...noFields,
                time: `${String(10 + (index % 5)).padStart(2, "0")}:00`,
              },
        clarificationField: null,
        question: null,
      },
      `Turn ${index}`,
    );
    assert.equal(
      new Set(state.drafts.map((draft) => draft.id)).size,
      state.drafts.length,
    );
  }
  assert.equal(state.drafts.length, 4);
  assert.equal(state.pending.length, 0);
  assert(state.drafts.every((draft) => draft.due));
});

test("invalid DST local time keeps the pending draft and asks for due again", () => {
  const state = next(
    undefined,
    {
      kind: "new_task",
      subject: "Bill",
      fields: { ...noFields, title: "Talk to Bill", person: "Bill" },
      clarificationField: "due",
      question: "When?",
    },
    "Talk to Bill.",
  );
  const retriable = next(
    state,
    {
      kind: "follow_up",
      subject: null,
      fields: { ...noFields, date: "2026-03-08", time: "02:30" },
      clarificationField: "due",
      question: "What date and time would you like?",
    },
    "March 8 at 2:30 AM.",
  );
  assert.equal(retriable.drafts.length, 1);
  assert.equal(retriable.drafts[0].id, state.drafts[0].id);
  assert.equal(retriable.pending[0].field, "due");
});

test("valid UTC and offset instants normalize to canonical UTC", () => {
  assert.equal(
    normalizeIsoInstant("2026-10-19T20:00:00Z"),
    "2026-10-19T20:00:00.000Z",
  );
  assert.equal(
    normalizeIsoInstant("2026-10-19T22:00:00+02:00"),
    "2026-10-19T20:00:00.000Z",
  );
  assert.equal(
    normalizeIsoInstant("2026-10-19T15:00:00-05:00"),
    "2026-10-19T20:00:00.000Z",
  );
});

test("a failed clarification can be retried without mutating or duplicating its draft", () => {
  const pending = next(
    undefined,
    {
      kind: "new_task",
      subject: "Bill",
      fields: { ...noFields, title: "Talk to Bill", person: "Bill" },
      clarificationField: "due",
      question: "When?",
    },
    "Talk to Bill.",
  );
  // A failed network request never reaches applyAssistantIntent, so this is the
  // exact authoritative state used by the retry.
  const retried = next(
    pending,
    {
      kind: "follow_up",
      subject: null,
      fields: { ...noFields, date: "2026-10-19", time: "15:00" },
      clarificationField: null,
      question: null,
    },
    "Tomorrow at 3 PM.",
  );
  assert.equal(retried.drafts.length, 1);
  assert.equal(retried.drafts[0].id, pending.drafts[0].id);
  assert.equal(retried.pending.length, 0);
});
