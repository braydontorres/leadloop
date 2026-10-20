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
} from "../lib/tasks";
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
