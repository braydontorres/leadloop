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
const testNow = new Date("2026-10-19T12:00:00Z");
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
    now: testNow,
  });
}

test("partial month and weekday never invent a title, date, or time", () => {
  ids = 0;
  const partial = turn(
    emptyConversationState(),
    {
      kind: "new_task",
      fields: {
        ...fields,
        title: "Set a reminder for",
        date: "2027-07-01",
        time: "12:00",
      },
    },
    "I want a reminder next July on a Saturday.",
  );
  assert.equal(partial.state.activeReminder?.title, "");
  assert.equal(partial.state.activeReminder?.due, "");
  assert.equal(partial.state.activeReminder?.pendingDate, null);
  assert.equal(partial.state.activeReminder?.pendingTime, null);
  assert.deepEqual(partial.state.activeReminder?.pendingDateConstraint, {
    year: 2027,
    month: 7,
    weekday: 6,
    occurrence: null,
  });
  assert.match(partial.reply, /What would you like me to remind you about/);
});

test("partial date constraints survive task details and validate the exact day", () => {
  ids = 0;
  const partial = turn(
    emptyConversationState(),
    {
      kind: "new_task",
      fields: { ...fields, title: "Set a reminder for", date: "2027-07-01" },
    },
    "I want a reminder next July on a Saturday.",
  );
  const task = turn(
    partial.state,
    {
      kind: "follow_up",
      fields: {
        ...fields,
        title: "Call Brad about his project",
        person: "Brad",
      },
    },
    "Call Brad about his project.",
  );
  assert.equal(task.state.activeReminder?.title, "Call Brad about his project");
  assert.deepEqual(task.state.activeReminder?.pendingDateConstraint, {
    year: 2027,
    month: 7,
    weekday: 6,
    occurrence: null,
  });
  assert.match(task.reply, /Which Saturday in July, and what time/);

  const complete = turn(
    task.state,
    {
      kind: "follow_up",
      fields: { ...fields, date: "2027-07-01", time: "15:00" },
    },
    "July 10 at 3 PM.",
  );
  assert.equal(complete.state.activeReminder?.pendingDateConstraint, null);
  assert.match(complete.reply, /Saturday, July 10.*3:00 PM/);
});

test("missing time, missing schedule, and complete reminders ask only for known gaps", () => {
  ids = 0;
  const tomorrow = turn(
    emptyConversationState(),
    {
      kind: "new_task",
      fields: {
        ...fields,
        title: "call Sarah",
        date: "2026-10-01",
        time: "12:00",
      },
    },
    "Remind me to call Sarah tomorrow.",
  );
  assert.equal(tomorrow.state.activeReminder?.pendingDate, "2026-10-20");
  assert.equal(tomorrow.state.activeReminder?.pendingTime, null);
  assert.match(tomorrow.reply, /What time/);

  const unscheduled = turn(
    emptyConversationState(),
    {
      kind: "new_task",
      fields: { ...fields, title: "order supplies" },
    },
    "Remind me to order supplies.",
  );
  assert.match(unscheduled.reply, /When would you like/);

  const complete = turn(
    emptyConversationState(),
    {
      kind: "new_task",
      fields: {
        ...fields,
        title: "call Bill",
        date: "2026-10-01",
        time: "17:00",
      },
    },
    "Remind me to call Bill tomorrow at 5 PM.",
  );
  assert.match(complete.reply, /October 20.*5:00 PM/);
});

test("an impossible date for a pending weekday asks for clarification", () => {
  ids = 0;
  const constraint = turn(
    emptyConversationState(),
    {
      kind: "new_task",
      fields: { ...fields },
    },
    "I want a reminder next July on a Saturday.",
  );
  const withTask = turn(
    constraint.state,
    { kind: "follow_up", fields: { ...fields, title: "Call Brad" } },
    "Call Brad.",
  );
  const invalid = turn(
    withTask.state,
    {
      kind: "follow_up",
      fields: { ...fields, date: "2027-07-10", time: "15:00" },
    },
    "July 11 at 3 PM.",
  );
  assert.equal(invalid.state.activeReminder?.due, "");
  assert.deepEqual(invalid.state.activeReminder?.pendingDateConstraint, {
    year: 2027,
    month: 7,
    weekday: 6,
    occurrence: null,
  });
  assert.match(invalid.reply, /doesn't match Saturday in July/);
});

test("an ordinal follow-up resolves the established month and weekday without AI date guessing", () => {
  ids = 0;
  const initial = turn(
    emptyConversationState(),
    { kind: "new_task", fields: { ...fields, title: "Call Brad" } },
    "I want a reminder to call Brad on a Thursday next July.",
  );
  assert.match(initial.reply, /Which Thursday in July/);
  assert.deepEqual(initial.state.activeReminder?.pendingDateConstraint, {
    year: 2027,
    month: 7,
    weekday: 4,
    occurrence: null,
  });

  const fourth = turn(
    initial.state,
    {
      kind: "none",
      fields,
    },
    "The fourth one.",
  );
  assert.equal(fourth.state.activeReminder?.pendingDate, "2027-07-22");
  assert.equal(fourth.state.activeReminder?.pendingDateConstraint, null);
  assert.match(fourth.reply, /What time/);

  const timed = turn(
    fourth.state,
    { kind: "follow_up", fields: { ...fields, time: "15:00" } },
    "3 PM.",
  );
  assert.match(timed.reply, /Thursday, July 22, 2027.*3:00 PM/);
});

test("fifth and last weekday replies resolve the active Saturday constraint instead of repeating it", () => {
  const responses = [
    { text: "The fifth Saturday.", expected: "2027-07-31" },
    { text: "The fifth one.", expected: "2027-07-31" },
    { text: "The last Saturday.", expected: "2027-07-31" },
  ];
  for (const { text, expected } of responses) {
    ids = 0;
    const initial = turn(
      emptyConversationState(),
      { kind: "new_task", fields: { ...fields, title: "order supplies" } },
      "Remind me to order supplies on a Saturday next July.",
    );
    assert.match(initial.reply, /Which Saturday in July/);
    const resolved = turn(initial.state, { kind: "none", fields }, text);
    assert.equal(resolved.state.activeReminder?.pendingDate, expected);
    assert.equal(resolved.state.activeReminder?.pendingDateConstraint, null);
    assert.match(resolved.reply, /What time/);
  }
});

test("a nonexistent ordinal weekday asks for clarification without substituting a date", () => {
  ids = 0;
  const invalid = turn(
    emptyConversationState(),
    { kind: "new_task", fields: { ...fields, title: "Call Brad" } },
    "Remind me to call Brad on the fifth Monday in February 2027.",
  );
  assert.equal(invalid.state.activeReminder?.due, "");
  assert.equal(invalid.state.activeReminder?.pendingDate, null);
  assert.deepEqual(invalid.state.activeReminder?.pendingDateConstraint, {
    year: 2027,
    month: 2,
    weekday: 1,
    occurrence: 5,
  });
  assert.match(invalid.reply, /only has four Mondays.*fourth Monday/i);
});

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

test("a supplied date survives until a time-only follow-up completes the same draft", () => {
  ids = 0;
  const initial = turn(
    emptyConversationState(),
    {
      kind: "new_task",
      fields: {
        ...fields,
        title: "talk to Brad",
        person: "Brad",
        date: "2026-10-20",
      },
    },
    "Remind me to talk to Brad tomorrow.",
  );
  assert.equal(initial.state.stage, "awaiting_details");
  assert.equal(initial.state.activeReminder?.title, "talk to Brad");
  assert.equal(initial.state.activeReminder?.pendingDate, "2026-10-20");
  assert.match(initial.reply, /What time/);
  const completed = turn(
    initial.state,
    { kind: "follow_up", fields: { ...fields, time: "15:00" } },
    "3 PM.",
  );
  assert.equal(completed.state.activeReminder?.id, "draft-1");
  assert.equal(completed.state.activeReminder?.pendingDate, null);
  assert.match(completed.reply, /3:00 PM/);
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
    "Call James tomorrow at 10 AM.",
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

test("a spoken goodbye ends a saved session, while no at confirmation asks for a correction", () => {
  ids = 0;
  const ready = turn(
    emptyConversationState(),
    {
      kind: "new_task",
      fields: {
        ...fields,
        title: "talk to Brad",
        date: "2026-10-20",
        time: "15:00",
      },
    },
    "Remind me to talk to Brad tomorrow at 3 PM.",
  );
  const no = turn(
    finishSpeech(ready.state),
    { kind: "end_conversation", fields },
    "No, I'm good.",
  );
  assert.equal(no.state.stage, "awaiting_details");
  const saved = turn(
    finishSpeech(ready.state),
    { kind: "confirm", fields },
    "Yes.",
  );
  const ended = turn(
    saved.state,
    { kind: "none", fields },
    "Yeah, that's everything.",
  );
  assert.equal(ended.state.stage, "ended");
  assert.equal(ended.state.activeReminder, null);
  assert.match(ended.reply, /Have a great day/);
});
