import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createCalendarExpression,
  mergeCalendarExpression,
  relativeDateExpressionFromText,
  resolveCalendarExpression,
} from "../lib/calendar-expression";
import {
  advanceConversation,
  emptyConversationState,
  finishSpeech,
  type AssistantIntent,
  type ConversationState,
} from "../lib/conversation-machine";
import {
  deterministicDateFromText,
  deterministicTimeFromText,
} from "../lib/reminder-details";
import { toLocalInput } from "../lib/tasks";

const zone = "America/Chicago";
const reference = new Date("2026-10-19T12:00:00Z");
const months = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const weekdays = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
const ordinalWords = ["first", "second", "third", "fourth", "fifth"];
const occurrences = [1, 2, 3, 4, 5, "last", "second_to_last"] as const;
const blankFields: AssistantIntent["fields"] = {
  title: null,
  person: null,
  date: null,
  time: null,
  notes: null,
  clearDue: false,
};

type Occurrence = (typeof occurrences)[number];

function iso(year: number, month: number, day: number) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Independent test oracle: enumerate days in a month rather than reusing the
 * production resolver's first-weekday arithmetic.
 */
function oracleDaysForWeekday(year: number, month: number, weekday: number) {
  const values: number[] = [];
  for (let day = 1; day <= 31; day += 1) {
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCMonth() + 1 !== month) break;
    if (date.getUTCDay() === weekday) values.push(day);
  }
  return values;
}

function oracleOrdinalDate(
  year: number,
  month: number,
  weekday: number,
  occurrence: Occurrence,
) {
  const days = oracleDaysForWeekday(year, month, weekday);
  const index =
    occurrence === "last"
      ? days.length - 1
      : occurrence === "second_to_last"
        ? days.length - 2
        : occurrence - 1;
  return index >= 0 && index < days.length
    ? iso(year, month, days[index])
    : null;
}

function resolvedExpression(args: {
  year: number | null;
  month: number;
  weekday: number;
  occurrence: Occurrence;
  time?: string;
  timeZone?: string;
  now?: Date;
}) {
  return resolveCalendarExpression(
    mergeCalendarExpression(
      createCalendarExpression(args.timeZone ?? zone, args.now ?? reference),
      {
        constraint: {
          year: args.year,
          month: args.month,
          weekday: args.weekday,
          occurrence: args.occurrence,
        },
        time: args.time ?? "17:00",
      },
    ),
  );
}

function localParts(now: Date, timeZone: string) {
  const values = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(values.find((part) => part.type === type)?.value ?? 0);
  return {
    year: value("year"),
    month: value("month"),
    day: value("day"),
    hour: value("hour"),
    minute: value("minute"),
  };
}

function oracleImplicitOrdinal(args: {
  now: Date;
  month: number;
  weekday: number;
  occurrence: Occurrence;
  time: string;
}) {
  const current = localParts(args.now, zone);
  let year = current.year + (args.month < current.month ? 1 : 0);
  let date = oracleOrdinalDate(year, args.month, args.weekday, args.occurrence);
  if (!date) return null;
  if (args.month === current.month) {
    const [hour, minute] = args.time.split(":").map(Number);
    const candidateTime = hour * 60 + minute;
    const referenceTime = current.hour * 60 + current.minute;
    if (
      Number(date.slice(-2)) < current.day ||
      (Number(date.slice(-2)) === current.day && candidateTime < referenceTime)
    ) {
      year += 1;
      date = oracleOrdinalDate(year, args.month, args.weekday, args.occurrence);
    }
  }
  return date;
}

function transition(
  state: ConversationState,
  intent: AssistantIntent,
  text: string,
  id: string,
) {
  return advanceConversation({
    state,
    result: { intent },
    text,
    timeZone: zone,
    createId: () => id,
    now: reference,
  });
}

test("Layer A: exhaustive ordinal calendar matrix matches an independent oracle", () => {
  let combinations = 0;
  for (let year = 2020; year < 2040; year += 1) {
    for (let month = 1; month <= 12; month += 1) {
      for (let weekday = 0; weekday < 7; weekday += 1) {
        for (const occurrence of occurrences) {
          combinations += 1;
          const expected = oracleOrdinalDate(year, month, weekday, occurrence);
          const result = resolvedExpression({
            year,
            month,
            weekday,
            occurrence,
            now: new Date("2019-01-01T00:00:00Z"),
          });
          if (!expected) {
            assert.equal(
              result.kind,
              "invalid",
              `${year}-${month}-${weekday}-${occurrence}`,
            );
            if (result.kind === "invalid")
              assert.equal(result.reason, "unavailable_occurrence");
            continue;
          }
          assert.equal(
            result.kind,
            "resolved",
            `${year}-${month}-${weekday}-${occurrence}`,
          );
          if (result.kind !== "resolved") continue;
          assert.equal(result.date, expected);
          const actual = new Date(`${result.date}T00:00:00Z`);
          assert.equal(actual.getUTCFullYear(), year);
          assert.equal(actual.getUTCMonth() + 1, month);
          assert.equal(actual.getUTCDay(), weekday);
          assert.ok(
            result.date.startsWith(
              `${year}-${String(month).padStart(2, "0")}-`,
            ),
          );
        }
      }
    }
  }
  assert.equal(combinations, 20 * 12 * 7 * 7);
});

test("Layer A: implicit years use the next upcoming ordinal across reference boundaries", () => {
  const references = [
    new Date("2026-01-01T12:00:00Z"),
    new Date("2026-06-15T12:00:00Z"),
    new Date("2026-10-19T12:00:00Z"),
    new Date("2026-12-31T12:00:00Z"),
    new Date("2028-02-28T12:00:00Z"),
  ];
  let combinations = 0;
  for (const now of references) {
    for (let month = 1; month <= 12; month += 1) {
      for (let weekday = 0; weekday < 7; weekday += 1) {
        for (const occurrence of occurrences) {
          combinations += 1;
          const expected = oracleImplicitOrdinal({
            now,
            month,
            weekday,
            occurrence,
            time: "17:00",
          });
          const result = resolvedExpression({
            year: null,
            month,
            weekday,
            occurrence,
            now,
          });
          if (!expected) {
            assert.equal(
              result.kind,
              "invalid",
              `${now.toISOString()} ${month}/${weekday}/${occurrence}`,
            );
            if (result.kind === "invalid")
              assert.equal(result.reason, "unavailable_occurrence");
            continue;
          }
          assert.equal(
            result.kind,
            "resolved",
            `${now.toISOString()} ${month}/${weekday}/${occurrence}`,
          );
          if (result.kind === "resolved") assert.equal(result.date, expected);
        }
      }
    }
  }
  assert.equal(combinations, references.length * 12 * 7 * 7);

  const passedToday = resolvedExpression({
    year: null,
    month: 10,
    weekday: 1,
    occurrence: 3,
    time: "06:00",
  });
  assert.equal(passedToday.kind, "resolved");
  if (passedToday.kind === "resolved")
    assert.equal(passedToday.date, "2027-10-18");

  const explicitPast = resolvedExpression({
    year: 2026,
    month: 6,
    weekday: 6,
    occurrence: 2,
  });
  assert.deepEqual(explicitPast, { kind: "invalid", reason: "past_date" });

  const leapDay = resolveCalendarExpression(
    mergeCalendarExpression(createCalendarExpression(zone, reference), {
      date: "2028-02-29",
      time: "17:00",
    }),
  );
  assert.equal(leapDay.kind, "resolved");
  const invalidLeapDay = resolveCalendarExpression(
    mergeCalendarExpression(createCalendarExpression(zone, reference), {
      date: "2027-02-29",
      time: "17:00",
    }),
  );
  assert.deepEqual(invalidLeapDay, { kind: "invalid", reason: "invalid_date" });
});

test("Layer B: supported date and time language has deterministic, non-fabricating extraction", () => {
  assert.equal(
    deterministicDateFromText("THE DAY AFTER TOMORROW!", zone, null, reference),
    "2026-10-21",
  );
  assert.equal(
    deterministicDateFromText("Tomorrow.", zone, null, reference),
    "2026-10-20",
  );
  assert.equal(
    deterministicDateFromText("today", zone, null, reference),
    "2026-10-19",
  );
  assert.equal(
    deterministicDateFromText("2027-02-28", zone, null, reference),
    "2027-02-28",
  );
  for (let weekday = 0; weekday < 7; weekday += 1) {
    const value = deterministicDateFromText(
      `Next ${weekdays[weekday]}`,
      zone,
      null,
      reference,
    );
    const current = new Date(Date.UTC(2026, 9, 19));
    const offset = (weekday - current.getUTCDay() + 7) % 7 || 7;
    current.setUTCDate(current.getUTCDate() + offset);
    assert.equal(
      value,
      iso(
        current.getUTCFullYear(),
        current.getUTCMonth() + 1,
        current.getUTCDate(),
      ),
    );
  }

  const relativeCases = [
    ["Tomorrow", "days", 1, "reference_day"],
    ["the day after tomorrow", "days", 2, "reference_day"],
    ["In five days.", "days", 5, "reference_day"],
    ["Three DAYS from now", "days", 3, "reference_day"],
    ["two weeks from today", "weeks", 2, "reference_day"],
    ["one week later", "weeks", 1, "existing_reminder_date"],
    ["TWO MONTHS FROM NOW", "months", 2, "reference_day"],
  ] as const;
  for (const [text, unit, amount, anchor] of relativeCases) {
    assert.deepEqual(relativeDateExpressionFromText(text), {
      kind: "calendar_offset",
      amount,
      unit,
      anchor,
    });
  }

  for (const minute of [0, 15, 45]) {
    for (let hour = 1; hour <= 12; hour += 1) {
      for (const meridiem of ["AM", "PM"] as const) {
        const actual = deterministicTimeFromText(
          `${hour}:${String(minute).padStart(2, "0")} ${meridiem}`,
        );
        const normalizedHour =
          meridiem === "AM"
            ? hour === 12
              ? 0
              : hour
            : hour === 12
              ? 12
              : hour + 12;
        assert.equal(
          actual,
          `${String(normalizedHour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
        );
      }
    }
  }
  assert.equal(deterministicTimeFromText("noon"), "12:00");
  assert.equal(deterministicTimeFromText("MIDNIGHT"), "00:00");
  assert.equal(deterministicTimeFromText("the fifth Saturday"), null);
  assert.equal(deterministicTimeFromText("at 5"), null);
  assert.equal(deterministicTimeFromText("at 13 PM"), null);
  assert.equal(
    deterministicTimeFromText("the fifth Saturday at 5 PM"),
    "17:00",
  );

  const implicitMonthDay = transition(
    emptyConversationState(),
    { kind: "new_task", fields: { ...blankFields, title: "order supplies" } },
    "Please remind me to order supplies on June 12 at 5 PM.",
    "month-day-without-year",
  );
  assert.equal(implicitMonthDay.state.stage, "reading_back");
  assert.match(implicitMonthDay.reply, /June 12, 2027.*5:00 PM/);
});

test("Layer A: time zones, midnight, and DST gaps do not fabricate a scheduled instant", () => {
  for (const timeZone of [
    "America/Chicago",
    "America/Denver",
    "America/New_York",
    "UTC",
  ]) {
    const calendar = mergeCalendarExpression(
      createCalendarExpression(timeZone, new Date("2026-10-01T12:00:00Z")),
      { date: "2026-11-02", time: "17:00" },
    );
    const resolved = resolveCalendarExpression(calendar);
    assert.equal(resolved.kind, "resolved", timeZone);
    if (resolved.kind === "resolved")
      assert.equal(
        toLocalInput(resolved.instant, timeZone),
        "2026-11-02T17:00",
      );
  }
  for (const timeZone of [
    "America/Chicago",
    "America/Denver",
    "America/New_York",
  ]) {
    const gap = resolveCalendarExpression(
      mergeCalendarExpression(
        createCalendarExpression(timeZone, new Date("2027-01-01T00:00:00Z")),
        { date: "2027-03-14", time: "02:30" },
      ),
    );
    assert.deepEqual(gap, { kind: "invalid", reason: "invalid_local_time" });

    const repeated = resolveCalendarExpression(
      mergeCalendarExpression(
        createCalendarExpression(timeZone, new Date("2026-01-01T00:00:00Z")),
        { date: "2026-11-01", time: "01:30" },
      ),
    );
    assert.equal(repeated.kind, "resolved", timeZone);
    if (repeated.kind === "resolved")
      assert.equal(
        toLocalInput(repeated.instant, timeZone),
        "2026-11-01T01:30",
      );
  }
  const invalidTime = resolveCalendarExpression(
    mergeCalendarExpression(createCalendarExpression(zone, reference), {
      date: "2026-10-20",
      time: "24:00",
    }),
  );
  assert.deepEqual(invalidTime, {
    kind: "invalid",
    reason: "invalid_local_time",
  });
});

test("Layer C: generated ordinal conversations preserve a single draft through every AI classification", () => {
  const classifications: AssistantIntent["kind"][] = [
    "none",
    "confirm",
    "new_task",
    "follow_up",
    "update",
  ];
  let checked = 0;
  for (let month = 1; month <= 12; month += 1) {
    for (let weekday = 0; weekday < 7; weekday += 1) {
      for (const occurrence of occurrences) {
        const expected = oracleOrdinalDate(2027, month, weekday, occurrence);
        const id = `generated-${month}-${weekday}-${occurrence}`;
        const first = transition(
          emptyConversationState(),
          {
            kind: "new_task",
            fields: { ...blankFields, title: `audit task ${checked}` },
          },
          `Remind me to audit task ${checked} on the ${
            occurrence === "last"
              ? "last"
              : occurrence === "second_to_last"
                ? "second-to-last"
                : ordinalWords[occurrence - 1]
          } ${weekdays[weekday]} in ${months[month - 1]} 2027.`,
          id,
        );
        const classification =
          classifications[checked % classifications.length];
        const followUp = transition(
          first.state,
          { kind: classification, fields: blankFields },
          `The ${
            occurrence === "last"
              ? "last"
              : occurrence === "second_to_last"
                ? "second-to-last"
                : ordinalWords[occurrence - 1]
          } one at 5 PM.`,
          `unexpected-${checked}`,
        );
        assert.equal(followUp.state.activeReminder?.id, id);
        assert.equal(
          followUp.state.activeReminder?.title,
          `audit task ${checked}`,
        );
        if (!expected) {
          assert.equal(followUp.state.stage, "awaiting_details");
          assert.match(followUp.reply, /only has/i);
        } else {
          assert.equal(followUp.state.stage, "reading_back");
          const resolved = resolveCalendarExpression(
            followUp.state.activeReminder!.calendar,
          );
          assert.equal(resolved.kind, "resolved");
          if (resolved.kind === "resolved") {
            assert.equal(resolved.date, expected);
            assert.equal(resolved.time, "17:00");
          }
          const confirmed = transition(
            finishSpeech(followUp.state),
            { kind: "confirm", fields: blankFields },
            "Yes.",
            `unexpected-confirm-${checked}`,
          );
          assert.equal(confirmed.savedTask?.id, id);
          assert.equal(confirmed.savedTask?.title, `audit task ${checked}`);
          assert.equal(confirmed.state.activeReminder, null);
        }
        checked += 1;
      }
    }
  }
  assert.equal(checked, 12 * 7 * 7);
});

test("Layer C: one hundred consecutive sessions do not leak draft state or stale confirmations", () => {
  let state = emptyConversationState();
  const savedIds = new Set<string>();
  let saves = 0;
  for (let index = 0; index < 100; index += 1) {
    const id = `session-${index}`;
    if (index % 5 === 2) {
      const incomplete = transition(
        state,
        {
          kind: "new_task",
          fields: { ...blankFields, title: `cancel ${index}` },
        },
        `Remind me to cancel ${index}.`,
        id,
      );
      const canceled = transition(
        incomplete.state,
        { kind: "cancel", fields: blankFields },
        "Cancel.",
        `unexpected-${index}`,
      );
      assert.equal(canceled.state.activeReminder, null);
      state = canceled.state;
      continue;
    }
    const initial = transition(
      state,
      {
        kind: "new_task",
        fields: { ...blankFields, title: `follow up ${index}` },
      },
      `Remind me to follow up ${index} today at 5 PM.`,
      id,
    );
    let ready = initial;
    if (index % 5 === 1) {
      ready = transition(
        finishSpeech(initial.state),
        { kind: "confirm", fields: blankFields },
        "Actually, two weeks from today.",
        `unexpected-correction-${index}`,
      );
      assert.equal(ready.state.activeReminder?.id, id);
      assert.match(ready.reply, /November 2, 2026.*5:00 PM/);
    }
    const confirmed = transition(
      finishSpeech(ready.state),
      { kind: "confirm", fields: blankFields },
      "Yes.",
      `unexpected-confirm-${index}`,
    );
    assert.equal(confirmed.savedTask?.id, id);
    assert.equal(confirmed.savedTask?.title, `follow up ${index}`);
    assert.equal(savedIds.has(id), false);
    savedIds.add(id);
    saves += 1;
    state = confirmed.state;
    if (index % 5 === 4) {
      const ended = transition(
        state,
        { kind: "none", fields: blankFields },
        "That's all.",
        `unexpected-end-${index}`,
      );
      assert.equal(ended.state.stage, "ended");
      assert.equal(ended.state.activeReminder, null);
      state = ended.state;
    }
  }
  assert.equal(saves, 80);
  assert.equal(savedIds.size, 80);
  assert.equal(state.activeReminder, null);
});

test("Layer C: time-only and date corrections retain every unrelated draft field", () => {
  const created = transition(
    emptyConversationState(),
    {
      kind: "new_task",
      fields: { ...blankFields, title: "call Brad", person: "Brad" },
    },
    "Remind me to call Brad on the fifth Saturday in July 2027 at 5 PM.",
    "correction-draft",
  );
  const ordinalCorrection = transition(
    finishSpeech(created.state),
    { kind: "confirm", fields: blankFields },
    "Actually, make it the fourth Saturday.",
    "must-not-replace-draft",
  );
  assert.equal(ordinalCorrection.state.activeReminder?.id, "correction-draft");
  assert.equal(ordinalCorrection.state.activeReminder?.title, "call Brad");
  assert.equal(ordinalCorrection.state.activeReminder?.person, "Brad");
  assert.match(ordinalCorrection.reply, /July 24, 2027.*5:00 PM/);

  const timeCorrection = transition(
    finishSpeech(ordinalCorrection.state),
    { kind: "none", fields: blankFields },
    "Actually, make it 3 PM.",
    "must-not-replace-draft-again",
  );
  assert.equal(timeCorrection.state.activeReminder?.id, "correction-draft");
  assert.equal(timeCorrection.state.activeReminder?.title, "call Brad");
  assert.match(timeCorrection.reply, /July 24, 2027.*3:00 PM/);
  const saved = transition(
    finishSpeech(timeCorrection.state),
    { kind: "confirm", fields: blankFields },
    "Yes.",
    "must-not-create-after-confirmation",
  );
  assert.equal(saved.savedTask?.id, "correction-draft");
  assert.match(saved.savedTask?.due ?? "", /2027-07-24T/);
});
