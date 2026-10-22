import assert from "node:assert/strict";
import test from "node:test";
import { fromLocalInput } from "../../lib/tasks";
import {
  dateInputFromPicker,
  datePickerLabel,
  datePickerValue,
} from "../src/date-picker";
import { localIsoDate, localTimeInput } from "../src/task-list";

test("the native date picker presents a friendly existing cloud reminder date", () => {
  const existingDue = new Date("2026-10-23T20:15:00.000Z");
  const date = localIsoDate(existingDue, "America/Chicago");

  assert.equal(date, "2026-10-23");
  assert.equal(datePickerLabel(date), "Friday, October 23, 2026");
  assert.equal(dateInputFromPicker(datePickerValue(date)), date);
  assert.equal(
    fromLocalInput(
      `${date}T${localTimeInput(existingDue, "America/Chicago")}`,
      "America/Chicago",
    ),
    existingDue.toISOString(),
  );
});

test("the date picker retains leap days and month/year boundaries without overflow", () => {
  assert.equal(datePickerLabel("2028-02-29"), "Tuesday, February 29, 2028");
  assert.equal(
    dateInputFromPicker(datePickerValue("2026-12-31")),
    "2026-12-31",
  );
  assert.equal(
    dateInputFromPicker(datePickerValue("2027-01-01")),
    "2027-01-01",
  );
});

test("a new reminder can default to the workspace's current calendar date", () => {
  const reference = new Date("2026-10-23T01:30:00.000Z");
  const chicagoToday = localIsoDate(reference, "America/Chicago");
  assert.equal(chicagoToday, "2026-10-22");
  assert.equal(
    dateInputFromPicker(datePickerValue(chicagoToday)),
    "2026-10-22",
  );
});
