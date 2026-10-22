import assert from "node:assert/strict";
import test from "node:test";
import {
  advanceConversation,
  emptyConversationState,
  finishSpeech,
} from "../../lib/conversation-machine";
import {
  canFinalizeHandsFreeTurn,
  canResumeHandsFreeListening,
} from "../src/hands-free-session";

test("one hands-free conversation keeps a pending reminder through follow-up and voice confirmation", () => {
  const createId = () => "hands-free-mike";
  const first = advanceConversation({
    state: emptyConversationState(),
    text: "Remind me to call Mike tomorrow.",
    timeZone: "America/Chicago",
    now: new Date("2026-10-22T17:00:00.000Z"),
    createId,
    result: {
      intent: {
        kind: "new_task",
        fields: {
          title: "Call Mike",
          person: "Mike",
          date: "2026-10-23",
          time: null,
          notes: null,
          clearDue: false,
        },
      },
    },
  });
  assert.equal(first.state.stage, "awaiting_details");
  assert.equal(first.state.activeReminder?.id, "hands-free-mike");

  const second = advanceConversation({
    state: first.state,
    text: "Three in the afternoon.",
    timeZone: "America/Chicago",
    now: new Date("2026-10-22T17:00:00.000Z"),
    createId,
    result: {
      intent: {
        kind: "follow_up",
        fields: {
          title: null,
          person: null,
          date: null,
          time: "15:00",
          notes: null,
          clearDue: false,
        },
      },
    },
  });
  const confirmed = advanceConversation({
    state: finishSpeech(second.state),
    text: "Yes.",
    timeZone: "America/Chicago",
    now: new Date("2026-10-22T17:00:00.000Z"),
    createId,
    result: {
      intent: {
        kind: "confirm",
        fields: {
          title: null,
          person: null,
          date: null,
          time: null,
          notes: null,
          clearDue: false,
        },
      },
    },
  });
  assert.equal(confirmed.savedTask?.id, "hands-free-mike");
  assert.equal(confirmed.savedTask?.due, "2026-10-23T20:00:00.000Z");
});

test("an ended session cannot resume or submit a competing duplicate callback", () => {
  assert.equal(
    canResumeHandsFreeListening({
      active: false,
      callbackSessionId: 3,
      currentSessionId: 4,
      nextStage: "saved",
    }),
    false,
  );
  assert.equal(
    canResumeHandsFreeListening({
      active: true,
      callbackSessionId: 4,
      currentSessionId: 4,
      nextStage: "ended",
    }),
    false,
  );
  assert.equal(canFinalizeHandsFreeTurn(8, null), true);
  assert.equal(canFinalizeHandsFreeTurn(8, 8), false);
});
