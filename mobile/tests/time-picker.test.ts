import assert from "node:assert/strict";
import test from "node:test";
import { fromLocalInput, toLocalInput } from "../../lib/tasks";
import {
  timeInputFromPicker,
  timePickerLabel,
  timePickerValue,
} from "../src/time-picker";
import { localIsoDate, localTimeInput } from "../src/task-list";

test("the native picker presents midnight, noon, and afternoon in 12-hour time", () => {
  assert.equal(timePickerLabel("00:00"), "12:00 AM");
  assert.equal(timePickerLabel("12:00"), "12:00 PM");
  assert.equal(timePickerLabel("15:15"), "3:15 PM");
  assert.equal(timeInputFromPicker(timePickerValue("15:15")), "15:15");
});

test("editing a cloud reminder preserves its America/Chicago calendar date and 3:15 PM", () => {
  const existingDue = new Date("2026-10-23T20:15:00.000Z");
  const timezone = "America/Chicago";
  const date = localIsoDate(existingDue, timezone);
  const time = localTimeInput(existingDue, timezone);

  assert.equal(date, "2026-10-23");
  assert.equal(timePickerLabel(time), "3:15 PM");
  assert.equal(
    fromLocalInput(`${date}T${time}`, timezone),
    existingDue.toISOString(),
  );

  const editedCloudReminder = {
    id: "call-mike",
    personId: "mike-customer",
    due: fromLocalInput(`${date}T${time}`, timezone),
  };
  assert.deepEqual(editedCloudReminder, {
    id: "call-mike",
    personId: "mike-customer",
    due: "2026-10-23T20:15:00.000Z",
  });
});

test("DST gaps show an inline validation error instead of creating a changed reminder", () => {
  assert.throws(
    () => fromLocalInput("2026-03-08T02:15", "America/Chicago"),
    /does not exist/i,
  );

  const fallBack = fromLocalInput("2026-11-01T01:15", "America/Chicago");
  assert.equal(toLocalInput(fallBack, "America/Chicago"), "2026-11-01T01:15");
});
