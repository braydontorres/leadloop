import { test } from "node:test";
import assert from "node:assert/strict";
import {
  saveTask,
  dateLabel,
  sampleStore,
  fromLocalInput,
  toLocalInput,
  DEFAULT_WORKING_DAYS,
  normalizeWorkingDays,
  remindersForPerson,
  type Person,
} from "../lib/tasks";

const person = (id: string, name: string): Person => ({
  id,
  name,
  business: "",
  email: "",
  phone: "",
  address: "",
  notes: "",
  interactions: [],
  createdAt: "2026-10-20T00:00:00.000Z",
  updatedAt: "2026-10-20T00:00:00.000Z",
});
test("saving a correction replaces the original without duplicates", () => {
  const original = sampleStore().tasks[0];
  const tasks = saveTask([original], { ...original, title: "Corrected task" });
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].title, "Corrected task");
});

test("working days default to Monday through Friday and normalize persisted settings", () => {
  assert.deepEqual(sampleStore().workingDays, DEFAULT_WORKING_DAYS);
  assert.deepEqual(normalizeWorkingDays(undefined), DEFAULT_WORKING_DAYS);
  assert.deepEqual(normalizeWorkingDays([5, 1, 5, 0, 9, "2"]), [0, 1, 5]);
});
test("task saving rejects blank titles and invalid reminder dates", () => {
  const t = sampleStore().tasks[0];
  assert.throws(() => saveTask([], { ...t, title: " " }));
  assert.throws(() => saveTask([], { ...t, due: "invalid" }));
});
test("confirmation dates reflect selected timezone", () => {
  assert.match(
    dateLabel("2026-10-17T01:00:00Z", "America/Chicago"),
    /Oct 16, 2026.*8:00 PM/,
  );
  assert.match(
    dateLabel("2026-10-17T01:00:00Z", "Asia/Tokyo"),
    /Oct 17, 2026.*10:00 AM/,
  );
});

test("converts configured-zone 9 PM to 21:00 without a UTC display shift", () => {
  const iso = fromLocalInput("2026-10-23T21:00", "America/Chicago");
  assert.equal(iso, "2026-10-24T02:00:00.000Z");
  assert.equal(toLocalInput(iso, "America/Chicago"), "2026-10-23T21:00");
  assert.match(dateLabel(iso, "America/Chicago"), /Oct 23, 2026.*9:00 PM/);
});

test("customer reminder lookup uses personId, sorts scheduled work, and leaves unscheduled work last", () => {
  const mike = person("mike-1", "Mike");
  const sarah = person("sarah-1", "Sarah");
  const reminders = remindersForPerson(
    [
      {
        id: "later",
        title: "Call Mike later",
        person: "Mike",
        personId: mike.id,
        due: "2026-11-02T21:00:00.000Z",
        completed: false,
        notes: "",
      },
      {
        id: "unscheduled",
        title: "Ask Mike about the estimate",
        person: "Mike",
        personId: mike.id,
        due: "",
        completed: false,
        notes: "",
      },
      {
        id: "early",
        title: "Call Mike first",
        person: "Mike",
        personId: mike.id,
        due: "2026-10-21T21:00:00.000Z",
        completed: false,
        notes: "",
      },
      {
        id: "sarah-task",
        title: "Call Sarah",
        person: "Sarah",
        personId: sarah.id,
        due: "2026-10-20T21:00:00.000Z",
        completed: false,
        notes: "",
      },
    ],
    [mike, sarah],
    mike,
  );
  assert.deepEqual(
    reminders.map((task) => task.id),
    ["early", "later", "unscheduled"],
  );
});

test("legacy name-only reminders are shown only for a uniquely named customer", () => {
  const uniqueMike = person("mike-1", "Mike");
  const legacyTask = {
    id: "legacy-mike",
    title: "Call Mike",
    person: " Mike ",
    due: "2026-10-21T21:00:00.000Z",
    completed: false,
    notes: "",
  };
  assert.equal(
    remindersForPerson([legacyTask], [uniqueMike], uniqueMike).length,
    1,
  );

  const anotherMike = person("mike-2", "Mike");
  assert.equal(
    remindersForPerson([legacyTask], [uniqueMike, anotherMike], uniqueMike)
      .length,
    0,
  );
  assert.equal(
    remindersForPerson([legacyTask], [uniqueMike, anotherMike], anotherMike)
      .length,
    0,
  );
});

test("a stable personId never falls back to a matching legacy name", () => {
  const mike = person("mike-1", "Mike");
  const otherMike = person("mike-2", "Mike");
  const task = {
    id: "linked-to-other-mike",
    title: "Do not leak this reminder",
    person: "Mike",
    personId: otherMike.id,
    due: "2026-10-21T21:00:00.000Z",
    completed: false,
    notes: "",
  };
  assert.equal(remindersForPerson([task], [mike, otherMike], mike).length, 0);
  assert.equal(
    remindersForPerson([task], [mike, otherMike], otherMike).length,
    1,
  );
});
