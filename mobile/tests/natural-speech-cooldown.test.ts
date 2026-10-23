import assert from "node:assert/strict";
import test from "node:test";
import {
  activeNaturalSpeechCooldown,
  resetNaturalSpeechCooldownsForTest,
  setNaturalSpeechCooldown,
} from "../src/natural-speech-cooldown";

test("a server Retry-After prevents duplicate natural speech requests during cooldown", () => {
  resetNaturalSpeechCooldownsForTest();
  setNaturalSpeechCooldown({
    workspaceId: "workspace-1",
    kind: "assistant_reply",
    retryAfterSeconds: 30,
    now: 1_000,
  });
  assert.equal(
    activeNaturalSpeechCooldown({
      workspaceId: "workspace-1",
      kind: "assistant_reply",
      now: 5_000,
    }),
    26,
  );
  assert.equal(
    activeNaturalSpeechCooldown({
      workspaceId: "workspace-1",
      kind: "assistant_reply",
      now: 31_000,
    }),
    0,
  );
});

test("preview cooldowns cannot block a real assistant reply", () => {
  resetNaturalSpeechCooldownsForTest();
  setNaturalSpeechCooldown({
    workspaceId: "workspace-1",
    kind: "preview",
    retryAfterSeconds: 60,
    now: 1_000,
  });
  assert.equal(
    activeNaturalSpeechCooldown({
      workspaceId: "workspace-1",
      kind: "preview",
      now: 2_000,
    }),
    59,
  );
  assert.equal(
    activeNaturalSpeechCooldown({
      workspaceId: "workspace-1",
      kind: "assistant_reply",
      now: 2_000,
    }),
    0,
  );
});
