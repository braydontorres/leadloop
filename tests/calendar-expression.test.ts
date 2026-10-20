import assert from "node:assert/strict";
import { test } from "node:test";
import {
  calendarFromLegacy,
  calendarProjection,
  createCalendarExpression,
  mergeCalendarExpression,
  resolveCalendarExpression,
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
