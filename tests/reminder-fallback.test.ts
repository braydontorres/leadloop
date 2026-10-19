import assert from "node:assert/strict";
import { test } from "node:test";
import {
  inferClearReminderRequest,
  recoverInitialReminderIntent,
} from "../lib/reminder-fallback";

test("retains a clear task and date if an initial AI response has no fields", () => {
  const fields = inferClearReminderRequest(
    "Remind me to talk to Brad tomorrow.",
    "America/Chicago",
    new Date("2026-10-19T18:00:00Z"),
  );
  assert.deepEqual(fields, {
    title: "talk to Brad",
    person: null,
    date: "2026-10-20",
    time: null,
    notes: null,
    clearDue: false,
  });
});

test("does not turn a follow-up for an active reminder into a new task", () => {
  const intent = recoverInitialReminderIntent({
    text: "3 PM",
    timeZone: "America/Chicago",
    activeReminder: { id: "draft-1" },
    intent: {
      kind: "none",
      fields: {
        title: null,
        person: null,
        date: null,
        time: null,
        notes: null,
        clearDue: false,
      },
    },
  });
  assert.equal(intent.kind, "none");
});

test("repairs an empty initial new-task interpretation without hardcoding a contact", () => {
  const intent = recoverInitialReminderIntent({
    text: "Remind me to email the client tomorrow at 3 PM.",
    timeZone: "America/Chicago",
    activeReminder: null,
    now: new Date("2026-10-19T18:00:00Z"),
    intent: {
      kind: "new_task",
      fields: {
        title: null,
        person: null,
        date: null,
        time: null,
        notes: null,
        clearDue: false,
      },
    },
  });
  assert.equal(intent.kind, "new_task");
  assert.equal(intent.fields.title, "email the client");
  assert.equal(intent.fields.date, "2026-10-20");
  assert.equal(intent.fields.time, "15:00");
});

test("keeps a clear imperative task when the model omits it", () => {
  const fields = inferClearReminderRequest(
    "Talk to the plumber tomorrow.",
    "America/Chicago",
    new Date("2026-10-19T18:00:00Z"),
  );
  assert.equal(fields?.title, "Talk to the plumber");
  assert.equal(fields?.date, "2026-10-20");
});

test("does not turn a partial scheduling request into a placeholder task", () => {
  const fields = inferClearReminderRequest(
    "I want a reminder next July on a Saturday.",
    "America/Chicago",
    new Date("2026-10-19T18:00:00Z"),
  );
  assert.equal(fields, null);
});
