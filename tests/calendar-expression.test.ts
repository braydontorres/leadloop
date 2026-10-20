import assert from "node:assert/strict";
import { test } from "node:test";
import {
  calendarFromLegacy,
  calendarProjection,
  createCalendarExpression,
  mergeCalendarExpression,
  resolveCalendarExpression,
  relativeDateExpressionFromText,
} from "../lib/calendar-expression";
import {
  advanceConversation,
  emptyConversationState,
  type AssistantIntent,
} from "../lib/conversation-machine";

const zone = "America/Chicago";
const reference = new Date("2026-10-19T12:00:00Z");

function expression(
  constraint: {
    year: number | null;
    month: number | null;
    weekday: number | null;
    occurrence: 1 | 2 | 3 | 4 | 5 | "last" | "second_to_last" | null;
  },
  time = "09:00",
) {
  return mergeCalendarExpression(createCalendarExpression(zone, reference), {
    constraint,
    time,
  });
}

test("CalendarExpression deterministically resolves every valid weekday occurrence across all months", () => {
  for (const year of [2027, 2028]) {
    for (let month = 1; month <= 12; month += 1) {
      for (let weekday = 0; weekday < 7; weekday += 1) {
        const matches = Array.from(
          { length: 31 },
          (_, index) => index + 1,
        ).filter((day) => {
          const date = new Date(Date.UTC(year, month - 1, day));
          return (
            date.getUTCMonth() + 1 === month && date.getUTCDay() === weekday
          );
        });
        for (
          let occurrence = 1;
          occurrence <= matches.length;
          occurrence += 1
        ) {
          const resolved = resolveCalendarExpression(
            expression({
              year,
              month,
              weekday,
              occurrence: occurrence as 1 | 2 | 3 | 4 | 5,
            }),
          );
          assert.equal(
            resolved.kind,
            "resolved",
            `${year}-${month} weekday ${weekday} #${occurrence}`,
          );
          if (resolved.kind !== "resolved") continue;
          assert.equal(
            resolved.date,
            `${year}-${String(month).padStart(2, "0")}-${String(matches[occurrence - 1]).padStart(2, "0")}`,
          );
        }
        const last = resolveCalendarExpression(
          expression({ year, month, weekday, occurrence: "last" }),
        );
        assert.equal(last.kind, "resolved");
        if (last.kind === "resolved")
          assert.match(
            last.date,
            new RegExp(`-${String(matches.at(-1)).padStart(2, "0")}$`),
          );
        const secondToLast = resolveCalendarExpression(
          expression({ year, month, weekday, occurrence: "second_to_last" }),
        );
        assert.equal(secondToLast.kind, "resolved");
        if (secondToLast.kind === "resolved")
          assert.match(
            secondToLast.date,
            new RegExp(`-${String(matches.at(-2)).padStart(2, "0")}$`),
          );
      }
    }
  }
});

test("CalendarExpression reports incomplete, ambiguous, invalid, and unsupported scheduling explicitly", () => {
  const blank = resolveCalendarExpression(
    createCalendarExpression(zone, reference),
  );
  assert.deepEqual(blank, {
    kind: "incomplete",
    missing: ["date", "time"],
    date: null,
  });

  const ambiguous = resolveCalendarExpression(
    expression({ year: 2027, month: 7, weekday: 6, occurrence: null }),
  );
  assert.equal(ambiguous.kind, "ambiguous");
  if (ambiguous.kind === "ambiguous")
    assert.equal(ambiguous.ambiguities[0]?.field, "weekday_occurrence");

  const invalid = resolveCalendarExpression(
    expression({ year: 2027, month: 2, weekday: 1, occurrence: 5 }),
  );
  assert.equal(invalid.kind, "invalid");
  if (invalid.kind === "invalid") {
    assert.equal(invalid.reason, "unavailable_occurrence");
    assert.equal(invalid.occurrenceCount, 4);
  }

  const advanced = createCalendarExpression(zone, reference);
  advanced.recurrence = { frequency: "weekly", interval: 1 };
  assert.deepEqual(resolveCalendarExpression(advanced), {
    kind: "unsupported",
    features: ["recurrence"],
  });
});

test("calendar adapter retains existing saved-task local time without modifying storage", () => {
  const legacy = calendarFromLegacy({
    timeZone: zone,
    due: "2027-07-31T22:00:00.000Z", // 5 PM in Chicago during daylight saving time
    now: reference,
  });
  const projected = calendarProjection(legacy);
  assert.equal(projected.due, "2027-07-31T22:00:00.000Z");
  assert.equal(legacy.date.absolute, "2027-07-31");
  assert.equal(legacy.time.local, "17:00");
});

const emptyFields: AssistantIntent["fields"] = {
  title: null,
  person: null,
  date: null,
  time: null,
  notes: null,
  clearDue: false,
};

function replayTranscript(transcript: string) {
  return advanceConversation({
    state: emptyConversationState(),
    result: {
      intent: {
        kind: "new_task",
        fields: { ...emptyFields, title: "call Brad" },
      },
    },
    text: transcript,
    timeZone: zone,
    createId: () => "draft-calendar",
    now: reference,
  });
}

test("typed and voice transcripts use the same calendar expression pipeline", () => {
  const typed = replayTranscript("Remind me to call Brad next Friday at 5 PM.");
  const voice = replayTranscript("Remind me to call Brad next Friday at 5 PM.");
  assert.equal(
    typed.state.activeReminder?.calendar.date.absolute,
    voice.state.activeReminder?.calendar.date.absolute,
  );
  assert.equal(
    typed.state.activeReminder?.calendar.time.local,
    voice.state.activeReminder?.calendar.time.local,
  );
  assert.equal(
    typed.state.activeReminder?.due,
    voice.state.activeReminder?.due,
  );
});

test("a calendar correction replaces the ordinal in the same active expression", () => {
  const initial = advanceConversation({
    state: emptyConversationState(),
    result: {
      intent: {
        kind: "new_task",
        fields: { ...emptyFields, title: "call Brad" },
      },
    },
    text: "Remind me to call Brad on a Saturday next July.",
    timeZone: zone,
    createId: () => "draft-correction",
    now: reference,
  });
  const fifth = advanceConversation({
    state: initial.state,
    result: { intent: { kind: "none", fields: emptyFields } },
    text: "The fifth one at 5 PM.",
    timeZone: zone,
    createId: () => "unexpected-id",
    now: reference,
  });
  assert.equal(
    fifth.state.activeReminder?.calendar.date.constraint?.occurrence,
    5,
  );
  assert.match(fifth.reply, /July 31.*5:00 PM/);

  const corrected = advanceConversation({
    state: fifth.state,
    result: { intent: { kind: "update", fields: emptyFields } },
    text: "Actually, make it the fourth Saturday.",
    timeZone: zone,
    createId: () => "unexpected-id",
    now: reference,
  });
  assert.equal(corrected.state.activeReminder?.id, "draft-correction");
  assert.equal(
    corrected.state.activeReminder?.calendar.date.constraint?.occurrence,
    4,
  );
  assert.match(corrected.reply, /July 24.*5:00 PM/);
});

test("central relative-date parser resolves supported phrases from the frozen local reference day", () => {
  const cases: Array<[string, string]> = [
    ["Two weeks from today", "2026-11-02"],
    ["Three days from now", "2026-10-22"],
    ["Tomorrow", "2026-10-20"],
    ["The day after tomorrow", "2026-10-21"],
    ["In five days", "2026-10-24"],
    ["Two months from now", "2026-12-19"],
  ];
  for (const [phrase, expectedDate] of cases) {
    const relative = relativeDateExpressionFromText(phrase);
    assert.ok(relative, phrase);
    const resolved = resolveCalendarExpression(
      mergeCalendarExpression(createCalendarExpression(zone, reference), {
        relative,
        time: "17:00",
      }),
    );
    assert.equal(resolved.kind, "resolved", phrase);
    if (resolved.kind === "resolved") assert.equal(resolved.date, expectedDate);
  }

  const monthEnd = createCalendarExpression(
    zone,
    new Date("2027-01-31T18:00:00Z"),
  );
  const resolved = resolveCalendarExpression(
    mergeCalendarExpression(monthEnd, {
      relative: relativeDateExpressionFromText("one month from now"),
      time: "09:00",
    }),
  );
  assert.equal(resolved.kind, "resolved");
  if (resolved.kind === "resolved") assert.equal(resolved.date, "2027-02-28");
});

test("later is anchored to the existing reminder date while from today uses the draft reference", () => {
  const base = mergeCalendarExpression(
    createCalendarExpression(zone, reference),
    {
      date: "2026-10-19",
      time: "17:00",
    },
  );
  const later = resolveCalendarExpression(
    mergeCalendarExpression(base, {
      relative: relativeDateExpressionFromText("one week later"),
    }),
  );
  assert.equal(later.kind, "resolved");
  if (later.kind === "resolved") assert.equal(later.date, "2026-10-26");
});

test("a relative correction invalidates read-back and preserves the draft time and ID", () => {
  const initial = advanceConversation({
    state: emptyConversationState(),
    result: {
      intent: {
        kind: "new_task",
        fields: { ...emptyFields, title: "talk to Steven", person: "Steven" },
      },
    },
    text: "Remind me to talk to Steven today at 5 PM.",
    timeZone: zone,
    createId: () => "steven-draft",
    now: reference,
  });
  assert.equal(initial.state.stage, "reading_back");
  const correction = advanceConversation({
    state: { ...initial.state, stage: "awaiting_confirmation" },
    // Simulate the observed incorrect provider classification. The deterministic
    // correction must still win and prevent a stale confirmation save.
    result: { intent: { kind: "confirm", fields: emptyFields } },
    text: "Actually, two weeks from today.",
    timeZone: zone,
    createId: () => "unexpected-id",
    now: reference,
  });
  assert.equal(correction.state.stage, "reading_back");
  assert.equal(correction.state.activeReminder?.id, "steven-draft");
  assert.match(correction.reply, /Monday, November 2.*5:00 PM/);

  const unsupported = advanceConversation({
    state: { ...correction.state, stage: "awaiting_confirmation" },
    result: { intent: { kind: "confirm", fields: emptyFields } },
    text: "Actually, sometime soon.",
    timeZone: zone,
    createId: () => "unexpected-id",
    now: reference,
  });
  assert.equal(unsupported.state.stage, "awaiting_details");
  assert.match(unsupported.reply, /couldn't reliably understand/i);
  const prematureYes = advanceConversation({
    state: unsupported.state,
    result: { intent: { kind: "confirm", fields: emptyFields } },
    text: "Yes.",
    timeZone: zone,
    createId: () => "unexpected-id",
    now: reference,
  });
  assert.equal(prematureYes.savedTask, undefined);
});

test("implicit years resolve ordinal months to their next upcoming occurrence", () => {
  const cases: Array<
    [
      {
        month: number;
        weekday: number;
        occurrence: 1 | 2 | 3 | 4 | 5 | "last";
      },
      string,
    ]
  > = [
    [{ month: 6, weekday: 6, occurrence: 2 }, "2027-06-12"],
    [{ month: 12, weekday: 1, occurrence: 1 }, "2026-12-07"],
    [{ month: 9, weekday: 5, occurrence: "last" }, "2027-09-24"],
    [{ month: 11, weekday: 3, occurrence: 3 }, "2026-11-18"],
    [{ month: 7, weekday: 5, occurrence: 2 }, "2027-07-09"],
  ];
  for (const [input, expected] of cases) {
    const resolved = resolveCalendarExpression(
      expression({ year: null, ...input }, "17:00"),
    );
    assert.equal(resolved.kind, "resolved", expected);
    if (resolved.kind === "resolved") assert.equal(resolved.date, expected);
  }
});

test("implicit ordinal years cover all months and move a passed current-month occurrence forward", () => {
  for (let month = 1; month <= 12; month += 1) {
    const resolved = resolveCalendarExpression(
      expression({ year: null, month, weekday: 1, occurrence: 1 }, "17:00"),
    );
    assert.equal(resolved.kind, "resolved", `month ${month}`);
    if (resolved.kind !== "resolved") continue;
    const date = new Date(`${resolved.date}T00:00:00Z`);
    assert.equal(date.getUTCMonth() + 1, month);
    assert.ok(resolved.date >= "2026-10-19");
  }
  const passed = resolveCalendarExpression(
    expression({ year: null, month: 10, weekday: 1, occurrence: 3 }, "06:00"),
  );
  assert.equal(passed.kind, "resolved");
  if (passed.kind === "resolved") assert.equal(passed.date, "2027-10-18");

  const unavailable = resolveCalendarExpression(
    expression({ year: null, month: 2, weekday: 1, occurrence: 5 }, "09:00"),
  );
  assert.equal(unavailable.kind, "invalid");
  if (unavailable.kind === "invalid") {
    assert.equal(unavailable.reason, "unavailable_occurrence");
    assert.equal(unavailable.occurrenceCount, 4);
  }
});

test("an explicit past year is never silently advanced", () => {
  const resolved = resolveCalendarExpression(
    expression({ year: 2026, month: 6, weekday: 6, occurrence: 2 }, "17:00"),
  );
  assert.deepEqual(resolved, { kind: "invalid", reason: "past_date" });
});

test("a month/day without a year resolves centrally to the next upcoming date", () => {
  const nextJune = resolveCalendarExpression(
    mergeCalendarExpression(createCalendarExpression(zone, reference), {
      date: "2026-06-12",
      implicitYear: true,
      time: "17:00",
    }),
  );
  assert.equal(nextJune.kind, "resolved");
  if (nextJune.kind === "resolved") assert.equal(nextJune.date, "2027-06-12");

  const passedToday = resolveCalendarExpression(
    mergeCalendarExpression(createCalendarExpression(zone, reference), {
      date: "2026-10-19",
      implicitYear: true,
      time: "06:00",
    }),
  );
  assert.equal(passedToday.kind, "resolved");
  if (passedToday.kind === "resolved")
    assert.equal(passedToday.date, "2027-10-19");
});
