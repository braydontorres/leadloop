import assert from "node:assert/strict";
import test from "node:test";
import {
  primaryConversationControl,
  type CaptureDisplayState,
} from "../src/capture-primary-control";

test("the same prominent conversation control remains visible in every active Capture state", () => {
  const states: CaptureDisplayState[] = [
    "listening",
    "user_speaking",
    "processing",
    "speaking",
    "saving",
    "error",
  ];
  for (const state of states) {
    assert.deepEqual(primaryConversationControl(true, state), {
      visible: true,
      label: "End Conversation",
      accessibilityLabel: "End voice conversation",
      icon: "■",
      tone: "danger",
    });
  }
});

test("the inactive Capture control stays the matching green start control", () => {
  assert.deepEqual(primaryConversationControl(false, "ready"), {
    visible: true,
    label: "Start Conversation",
    accessibilityLabel: "Start voice conversation",
    icon: "●",
    tone: "start",
  });
});
