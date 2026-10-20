import assert from "node:assert/strict";
import { test } from "node:test";
import {
  calendarLanguageFieldsFromText,
  createCalendarExpression,
  mergeCalendarExpression,
  naturalTimeFromText,
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

const zone = "America/Chicago";
const reference = new Date("2026-10-19T12:00:00Z");
const fields: AssistantIntent["fields"] = {
  title: null,
  person: null,
  date: null,
  time: null,
  notes: null,
  clearDue: false,
};

function expression() {
  return createCalendarExpression(zone, reference);
}

function resolveText(text: string, current = expression()) {
  const language = calendarLanguageFieldsFromText(text, current);
  let next = current;
  if (language.replacesDateConstraint && !language.relative)
    next = mergeCalendarExpression(next, { constraint: null });
  next = mergeCalendarExpression(next, {
    date: language.date ?? undefined,
    time: language.time ?? undefined,
    relative: language.relative ?? undefined,
  });
  return { language, resolution: resolveCalendarExpression(next) };
}

function turn(
  state: ConversationState,
  intent: AssistantIntent,
  text: string,
  id = "phase-c-draft",
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

test("Phase C resolves this, next, and after-next weekdays with one convention", () => {
  const cases = [
    ["this Monday", "2026-10-19"],
    ["next Monday", "2026-10-26"],
    ["the Monday after next", "2026-11-02"],
    ["this Friday", "2026-10-23"],
    ["next Friday", "2026-10-23"],
    ["Friday after next", "2026-10-30"],
  ] as const;
  for (const [text, expected] of cases) {
    const value = resolveText(`${text} at 5 PM`);
    assert.equal(value.resolution.kind, "resolved", text);
    if (value.resolution.kind === "resolved") {
      assert.equal(value.resolution.date, expected);
      assert.equal(value.resolution.time, "17:00");
    }
  }
});

test("Phase C handles calendar-aware relative dates and explicit-date offsets", () => {
  const relativeCases = [
    ["in 3 days at 5 PM", "2026-10-22"],
    ["two months from today at 5 PM", "2026-12-19"],
    ["one year from now at 5 PM", "2027-10-19"],
    ["a week from tomorrow at 5 PM", "2026-10-27"],
    ["two weeks from next Friday at 5 PM", "2026-11-06"],
    ["a day before July 4, 2027 at 5 PM", "2027-07-03"],
  ] as const;
  for (const [text, expected] of relativeCases) {
    const value = resolveText(text);
    assert.equal(value.resolution.kind, "resolved", text);
    if (value.resolution.kind === "resolved") {
      assert.equal(value.resolution.date, expected);
      assert.equal(value.resolution.time, "17:00");
    }
  }

  const leapMonthEnd = resolveText(
    "in one month at 5 PM",
    mergeCalendarExpression(
      createCalendarExpression(zone, new Date("2028-01-31T12:00:00Z")),
      { time: "17:00" },
    ),
  );
  assert.equal(leapMonthEnd.resolution.kind, "resolved");
  if (leapMonthEnd.resolution.kind === "resolved")
    assert.equal(leapMonthEnd.resolution.date, "2028-02-29");

  assert.deepEqual(relativeDateExpressionFromText("two weeks before that"), {
    kind: "calendar_offset",
    amount: -2,
    unit: "weeks",
    anchor: "existing_reminder_date",
  });
});

test("Phase C understands safe spoken clocks and keeps ambiguous clocks unanswered", () => {
  const times = [
    ["half past three PM", "15:30"],
    ["quarter past four AM", "04:15"],
    ["quarter to five PM", "16:45"],
    ["three thirty PM", "15:30"],
    ["three fifteen PM", "15:15"],
    ["noon", "12:00"],
    ["midnight", "00:00"],
  ] as const;
  for (const [text, expected] of times)
    assert.deepEqual(naturalTimeFromText(text), {
      time: expected,
      ambiguous: false,
    });
  assert.deepEqual(naturalTimeFromText("half past three"), {
    time: null,
    ambiguous: true,
  });
  assert.deepEqual(naturalTimeFromText("three thirty"), {
    time: null,
    ambiguous: true,
  });
});

test("Phase C spoken clocks prefer complete expressions over overlapping clock substrings", () => {
  const required = [
    ["Quarter to five PM", "16:45"],
    ["Quarter to 5 PM", "16:45"],
    ["A quarter to 5 p.m.", "16:45"],
    ["No, make it a quarter to 5 p.m.", "16:45"],
    ["Actually, Friday after next at quarter to 5 PM", "16:45"],
    ["Half past 3 PM", "15:30"],
    ["Quarter past 4 AM", "04:15"],
    ["5 PM", "17:00"],
  ] as const;
  for (const [text, expected] of required)
    assert.deepEqual(naturalTimeFromText(text), {
      time: expected,
      ambiguous: false,
    });

  const words = [
    "twelve",
    "one",
    "two",
    "three",
    "four",
    "five",
    "six",
    "seven",
    "eight",
    "nine",
    "ten",
    "eleven",
  ];
  for (let hour = 1; hour <= 12; hour += 1) {
    const word = words[hour % 12];
    for (const marker of ["AM", "PM"] as const) {
      const base = marker === "PM" ? (hour === 12 ? 12 : hour + 12) : hour === 12 ? 0 : hour;
      for (const sourceHour of [String(hour), word]) {
        assert.equal(
          naturalTimeFromText(`Please make it half past ${sourceHour} ${marker}.`).time,
          `${String(base).padStart(2, "0")}:30`,
        );
        assert.equal(
          naturalTimeFromText(`Set it for quarter past ${sourceHour} ${marker}, please.`).time,
          `${String(base).padStart(2, "0")}:15`,
        );
      }
    }
  }

  assert.deepEqual(naturalTimeFromText("quarter to 12 PM"), {
    time: "11:45",
    ambiguous: false,
  });
  assert.deepEqual(naturalTimeFromText("quarter to 12 AM"), {
    time: null,
    ambiguous: true,
  });
  assert.deepEqual(naturalTimeFromText("quarter to twelve AM"), {
    time: null,
    ambiguous: true,
  });
  assert.deepEqual(naturalTimeFromText("half past 12 AM"), {
    time: "00:30",
    ambiguous: false,
  });
  assert.deepEqual(naturalTimeFromText("quarter past 12 PM"), {
    time: "12:15",
    ambiguous: false,
  });
  assert.deepEqual(naturalTimeFromText("quarter to 5 p m"), {
    time: "16:45",
    ambiguous: false,
  });
});

test("Phase C numeric spoken-time correction preserves one draft and requires reconfirmation", () => {
  const first = turn(
    emptyConversationState(),
    {
      kind: "new_task",
      fields: { ...fields, title: "call Brad", person: "Brad" },
    },
    "Remind me to call Brad Friday after next at 5 PM.",
    "numeric-time-draft",
  );
  assert.equal(first.state.stage, "reading_back");
  assert.match(first.reply, /Friday, October 30, 2026.*5:00 PM/);

  const corrected = turn(
    finishSpeech(first.state),
    { kind: "confirm", fields },
    "No, make it a quarter to 5 p.m.",
    "must-not-replace-numeric-time-draft",
  );
  assert.equal(corrected.savedTask, undefined);
  assert.equal(corrected.state.activeReminder?.id, "numeric-time-draft");
  assert.equal(corrected.state.activeReminder?.title, "call Brad");
  assert.equal(corrected.state.activeReminder?.person, "Brad");
  assert.equal(corrected.state.stage, "reading_back");
  const resolution = resolveCalendarExpression(
    corrected.state.activeReminder!.calendar,
  );
  assert.equal(resolution.kind, "resolved");
  if (resolution.kind === "resolved") {
    assert.equal(resolution.date, "2026-10-30");
    assert.equal(resolution.time, "16:45");
  }
  assert.match(corrected.reply, /Friday, October 30, 2026.*4:45 PM/);
  assert.match(corrected.reply, /Is that correct/);

  const saved = turn(
    finishSpeech(corrected.state),
    { kind: "confirm", fields },
    "Yes.",
    "must-not-create-after-numeric-confirmation",
  );
  assert.equal(saved.savedTask?.id, "numeric-time-draft");
  assert.equal(saved.state.activeReminder, null);
  assert.match(saved.savedTask?.due ?? "", /2026-10-30T21:45:00.000Z/);
});

test("Phase C original correction conversation works with numeric spoken hours", () => {
  const first = turn(
    emptyConversationState(),
    {
      kind: "new_task",
      fields: { ...fields, title: "call Brad", person: "Brad" },
    },
    "Remind me to call Brad this Friday at half past 3 PM.",
  );
  const corrected = turn(
    finishSpeech(first.state),
    { kind: "confirm", fields },
    "Actually, Friday after next at quarter to 5 PM.",
  );
  assert.equal(corrected.state.activeReminder?.id, "phase-c-draft");
  assert.equal(corrected.state.activeReminder?.title, "call Brad");
  assert.equal(corrected.state.activeReminder?.person, "Brad");
  assert.match(corrected.reply, /Friday, October 30, 2026.*4:45 PM/);
});

test("Phase C resolves duration clocks from the frozen reference or existing reminder", () => {
  for (const [text, expected] of [
    ["in ninety minutes", "2026-10-19T08:30"],
    ["in two hours", "2026-10-19T09:00"],
    ["in an hour and a half", "2026-10-19T08:30"],
  ] as const) {
    const value = resolveText(text);
    assert.equal(value.resolution.kind, "resolved", text);
    if (value.resolution.kind === "resolved")
      assert.equal(
        `${value.resolution.date}T${value.resolution.time}`,
        expected,
      );
  }
  const existing = mergeCalendarExpression(expression(), {
    date: "2026-10-20",
    time: "17:00",
  });
  const correction = resolveText("Actually, in two hours.", existing);
  assert.equal(correction.resolution.kind, "resolved");
  if (correction.resolution.kind === "resolved")
    assert.equal(
      `${correction.resolution.date}T${correction.resolution.time}`,
      "2026-10-20T19:00",
    );
});

test("Phase C conversations preserve a draft through relative and spoken-time corrections", () => {
  const first = turn(
    emptyConversationState(),
    {
      kind: "new_task",
      fields: { ...fields, title: "call Brad", person: "Brad" },
    },
    "Remind me to call Brad this Friday at half past three PM.",
  );
  assert.equal(first.state.stage, "reading_back");
  assert.match(first.reply, /Friday, October 23, 2026.*3:30 PM/);
  const dateCorrection = turn(
    finishSpeech(first.state),
    { kind: "confirm", fields },
    "Actually, the Friday after next.",
  );
  assert.equal(dateCorrection.state.activeReminder?.id, "phase-c-draft");
  assert.equal(dateCorrection.state.activeReminder?.title, "call Brad");
  assert.match(dateCorrection.reply, /Friday, October 30, 2026.*3:30 PM/);
  const timeCorrection = turn(
    finishSpeech(dateCorrection.state),
    { kind: "none", fields },
    "Actually, quarter to five PM.",
  );
  assert.match(timeCorrection.reply, /Friday, October 30, 2026.*4:45 PM/);
  const saved = turn(
    finishSpeech(timeCorrection.state),
    { kind: "confirm", fields },
    "Yes.",
  );
  assert.equal(saved.savedTask?.id, "phase-c-draft");

  const ambiguous = turn(
    emptyConversationState(),
    { kind: "new_task", fields: { ...fields, title: "call Sarah" } },
    "Remind me to call Sarah tomorrow at half past three.",
  );
  assert.equal(ambiguous.state.stage, "awaiting_details");
  assert.match(ambiguous.reply, /What time/);
});

test("Phase C generated conversations start incomplete and resolve every later ordinal answer", () => {
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
  const ordinalWords = [
    "first",
    "second",
    "third",
    "fourth",
    "fifth",
    "last",
    "second-to-last",
  ];
  let checked = 0;
  for (let month = 0; month < months.length; month += 1) {
    for (let weekday = 0; weekday < weekdays.length; weekday += 1) {
      for (const ordinal of ordinalWords) {
        const id = `incomplete-${month}-${weekday}-${ordinal}`;
        const initial = turn(
          emptyConversationState(),
          { kind: "new_task", fields: { ...fields, title: `task ${checked}` } },
          `Remind me to task ${checked} on a ${weekdays[weekday]} in ${months[month]} 2027.`,
          id,
        );
        assert.match(initial.reply, new RegExp(`Which ${weekdays[weekday]}`));
        const completed = turn(
          initial.state,
          { kind: checked % 2 ? "none" : "confirm", fields },
          `The ${ordinal} one at 5 PM.`,
          `unexpected-${checked}`,
        );
        assert.equal(completed.state.activeReminder?.id, id);
        // A nonexistent fifth weekday remains a clarification; every other
        // supplied ordinal advances beyond the original missing question.
        if (completed.state.stage === "reading_back")
          assert.match(completed.reply, /Is that correct/);
        else assert.match(completed.reply, /only has/i);
        checked += 1;
      }
    }
  }
  assert.equal(checked, 12 * 7 * 7);
});
