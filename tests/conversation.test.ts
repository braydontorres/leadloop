import { test } from "node:test";
import assert from "node:assert/strict";
import {
  advanceConversation,
  emptyConversationState,
  finishSpeech,
  type AssistantIntent,
} from "../lib/conversation-machine";

const fields: AssistantIntent["fields"] = {
  title: null,
  person: null,
  date: null,
  time: null,
  notes: null,
  clearDue: false,
};

let ids = 0;
function turn(
  state: ReturnType<typeof emptyConversationState>,
  intent: AssistantIntent,
  text: string,
) {
  return advanceConversation({
    state,
    result: { intent },
    text,
    timeZone: "America/Chicago",
    createId: () => `draft-${++ids}`,
  });
}

test("A: missing time asks once, reads back, then saves exactly one task", () => {
  ids = 0;
  const first = turn(
    emptyConversationState(),
    {
      kind: "new_task",
      fields: {
        ...fields,
        title: "talk to Bill about washing his clothes",
        person: "Bill",
      },
    },
    "Talk to Bill about washing his clothes.",
  );
  assert.equal(first.state.stage, "awaiting_details");
  assert.match(first.reply, /When would you like/);
  const complete = turn(
    first.state,
    {
      kind: "follow_up",
      fields: { ...fields, date: "2026-10-20", time: "17:00" },
    },
    "Tomorrow at 5 PM.",
  );
  assert.equal(complete.state.stage, "reading_back");
  assert.match(complete.reply, /Tuesday, October 20.*5:00 PM/);
  const confirmed = turn(
    finishSpeech(complete.state),
    { kind: "confirm", fields },
    "Yes.",
  );
  assert.equal(confirmed.savedTask?.id, "draft-1");
  assert.equal(confirmed.state.activeReminder, null);
  assert.equal(confirmed.state.stage, "saved");
});

test("B and C: complete request reads back, then correction keeps its ID", () => {
  ids = 0;
  const created = turn(
    emptyConversationState(),
    {
      kind: "new_task",
      fields: {
        ...fields,
        title: "talk to Bill",
        person: "Bill",
        date: "2026-10-20",
        time: "17:00",
      },
    },
    "Talk to Bill tomorrow at 5 PM.",
  );
  assert.equal(created.state.stage, "reading_back");
  const corrected = turn(
    finishSpeech(created.state),
    {
      kind: "update",
      fields: { ...fields, time: "18:00" },
    },
    "Actually, make that 6 PM.",
  );
  assert.equal(corrected.state.activeReminder?.id, "draft-1");
  assert.match(corrected.reply, /6:00 PM/);
});

test("D and F: no requests a correction and cancel discards the unfinished reminder", () => {
  ids = 0;
  const created = turn(
    emptyConversationState(),
    {
      kind: "new_task",
      fields: {
        ...fields,
        title: "call Sarah",
        date: "2026-10-20",
        time: "09:00",
      },
    },
    "Call Sarah tomorrow at 9.",
  );
  const rejected = turn(
    finishSpeech(created.state),
    { kind: "reject", fields },
    "No.",
  );
  assert.equal(rejected.state.stage, "awaiting_details");
  assert.match(rejected.reply, /What should I change/);
  const canceled = turn(rejected.state, { kind: "cancel", fields }, "Cancel.");
  assert.equal(canceled.state.activeReminder, null);
  assert.equal(canceled.state.stage, "canceled");
});

test("E: a saved Bill reminder starts a separate Sarah conversation", () => {
  ids = 0;
  const bill = turn(
    emptyConversationState(),
    {
      kind: "new_task",
      fields: {
        ...fields,
        title: "talk to Bill",
        date: "2026-10-20",
        time: "17:00",
      },
    },
    "Talk to Bill tomorrow at 5.",
  );
  const saved = turn(
    finishSpeech(bill.state),
    { kind: "confirm", fields },
    "Correct.",
  );
  const sarah = turn(
    saved.state,
    {
      kind: "new_task",
      fields: {
        ...fields,
        title: "call Sarah",
        person: "Sarah",
        date: "2026-10-21",
        time: "09:00",
      },
    },
    "Remind me to call Sarah Wednesday at 9 AM.",
  );
  assert.equal(sarah.state.activeReminder?.title, "call Sarah");
  assert.notEqual(sarah.state.activeReminder?.id, saved.savedTask?.id);
});

test("G: read-back waits for speech completion before accepting confirmation", () => {
  ids = 0;
  const ready = turn(
    emptyConversationState(),
    {
      kind: "new_task",
      fields: {
        ...fields,
        title: "call James",
        date: "2026-10-20",
        time: "10:00",
      },
    },
    "Call James tomorrow at 10.",
  );
  const early = turn(ready.state, { kind: "confirm", fields }, "Yes.");
  assert.equal(early.savedTask, undefined);
  const afterSpeech = turn(
    finishSpeech(ready.state),
    { kind: "confirm", fields },
    "Yes.",
  );
  assert.equal(afterSpeech.savedTask?.title, "call James");
});
