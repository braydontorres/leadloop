import assert from "node:assert/strict";
import test from "node:test";
import type { ConversationContext } from "../lib/conversation-machine";
import { standaloneVoiceConfirmation } from "../lib/voice-confirmation";

const awaitingConfirmation = {
  stage: "awaiting_confirmation" as const,
  history: [],
  activeReminder: {
    id: "reminder-1",
    title: "Call Mike",
    person: "Mike",
    due: "2026-10-23T20:00:00.000Z",
    notes: "",
    calendar: {
      timeZone: "America/Chicago",
      localDate: "2026-10-23",
      localTime: "15:00",
    },
    pendingDate: "2026-10-23",
    pendingTime: "15:00",
    pendingDateConstraint: null,
  },
} as unknown as ConversationContext;

test("only strict standalone confirmations bypass interpretation after read-back", () => {
  assert.equal(
    standaloneVoiceConfirmation("Yes.", awaitingConfirmation)?.intent.kind,
    "confirm",
  );
  assert.equal(
    standaloneVoiceConfirmation("Correct", awaitingConfirmation)?.intent.kind,
    "confirm",
  );
  assert.equal(
    standaloneVoiceConfirmation("No", awaitingConfirmation)?.intent.kind,
    "reject",
  );
  assert.equal(
    standaloneVoiceConfirmation("Yes, make it five PM", awaitingConfirmation),
    null,
  );
});

test("a confirmation never bypasses AI outside an unambiguous confirmation stage", () => {
  assert.equal(
    standaloneVoiceConfirmation("Yes", {
      ...awaitingConfirmation,
      stage: "awaiting_details",
    }),
    null,
  );
  assert.equal(
    standaloneVoiceConfirmation("Yes", {
      ...awaitingConfirmation,
      activeReminder: null,
    }),
    null,
  );
});
