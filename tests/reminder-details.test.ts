import assert from "node:assert/strict";
import { test } from "node:test";
import {
  calendarDateForWeekdayOccurrence,
  cleanReminderTitle,
  deterministicTimeFromText,
  deriveDateConstraint,
  resolveDateConstraint,
  weekdayOccurrenceCount,
  weekdayOccurrenceFromText,
} from "../lib/reminder-details";

test("extracts explicit times without confusing an ordinal word for a clock", () => {
  assert.equal(
    deterministicTimeFromText("the fifth Saturday at 5 PM"),
    "17:00",
  );
  assert.equal(deterministicTimeFromText("the last Saturday at noon"), "12:00");
  assert.equal(deterministicTimeFromText("the fifth Saturday"), null);
  assert.equal(deterministicTimeFromText("five in the morning"), "05:00");
});

test("removes trailing scheduling language from AI-extracted titles", () => {
  assert.equal(
    cleanReminderTitle("get groceries next Saturday in July"),
    "get groceries",
  );
  assert.equal(
    cleanReminderTitle("Order supplies on a Saturday next July"),
    "Order supplies",
  );
});

test("calculates every ordinal weekday in July 2027", () => {
  const saturday = 6;
  assert.equal(weekdayOccurrenceCount(2027, 7, saturday), 5);
  assert.equal(
    calendarDateForWeekdayOccurrence(2027, 7, saturday, 1).date,
    "2027-07-03",
  );
  assert.equal(
    calendarDateForWeekdayOccurrence(2027, 7, saturday, 2).date,
    "2027-07-10",
  );
  assert.equal(
    calendarDateForWeekdayOccurrence(2027, 7, saturday, 3).date,
    "2027-07-17",
  );
  assert.equal(
    calendarDateForWeekdayOccurrence(2027, 7, saturday, 4).date,
    "2027-07-24",
  );
  assert.equal(
    calendarDateForWeekdayOccurrence(2027, 7, saturday, 5).date,
    "2027-07-31",
  );
});

test("calculates fourth, fifth, last, and second-to-last weekdays", () => {
  const thursday = 4;
  assert.equal(
    calendarDateForWeekdayOccurrence(2027, 7, thursday, 4).date,
    "2027-07-22",
  );
  assert.equal(
    calendarDateForWeekdayOccurrence(2027, 7, thursday, 5).date,
    "2027-07-29",
  );
  assert.equal(
    calendarDateForWeekdayOccurrence(2027, 7, thursday, "last").date,
    "2027-07-29",
  );
  assert.equal(
    calendarDateForWeekdayOccurrence(2027, 7, thursday, "second_to_last").date,
    "2027-07-22",
  );
});

test("rejects unavailable ordinal weekdays and handles leap years and year boundaries", () => {
  const fifthMonday = calendarDateForWeekdayOccurrence(2027, 2, 1, 5);
  assert.equal(fifthMonday.date, null);
  assert.equal(fifthMonday.occurrenceCount, 4);
  assert.equal(
    calendarDateForWeekdayOccurrence(2028, 2, 2, 5).date,
    "2028-02-29",
  );
  assert.equal(
    calendarDateForWeekdayOccurrence(2028, 1, 1, "last").date,
    "2028-01-31",
  );
});

test("extracts ordinal language and resolves complete constraints", () => {
  assert.equal(
    weekdayOccurrenceFromText("the second-to-last Friday"),
    "second_to_last",
  );
  assert.equal(weekdayOccurrenceFromText("the third one"), 3);
  assert.deepEqual(
    deriveDateConstraint(
      "the fourth Thursday in July 2027",
      "America/Chicago",
      new Date("2026-10-19T12:00:00Z"),
    ),
    { year: 2027, month: 7, weekday: 4, occurrence: 4 },
  );
  assert.deepEqual(
    resolveDateConstraint({ year: 2027, month: 7, weekday: 4, occurrence: 4 }),
    { status: "resolved", date: "2027-07-22" },
  );
});
