import assert from "node:assert/strict";
import test from "node:test";
import {
  assistantPreferencesKey,
  DEFAULT_ASSISTANT_PREFERENCES,
  deviceSpeechRate,
  normalizeAssistantPreferences,
} from "../src/assistant-preferences";

test("assistant voice preferences default to included device speech and scope storage", () => {
  assert.deepEqual(normalizeAssistantPreferences(undefined), {
    ...DEFAULT_ASSISTANT_PREFERENCES,
  });
  assert.equal(
    assistantPreferencesKey("user-a", "workspace-a"),
    "leadloop.assistant-speech.v1.user-a.workspace-a",
  );
  assert.notEqual(
    assistantPreferencesKey("user-a", "workspace-a"),
    assistantPreferencesKey("user-b", "workspace-a"),
  );
});

test("assistant preferences reject malformed cloud voice values without enabling paid playback", () => {
  assert.deepEqual(
    normalizeAssistantPreferences({
      mode: "natural",
      voice: "unknown",
      speed: "turbo",
      muted: "false",
    }),
    {
      mode: "natural",
      voice: "alloy",
      speed: "normal",
      muted: false,
    },
  );
});

test("device voice speed remains conversational and has explicit pace choices", () => {
  assert.equal(deviceSpeechRate("relaxed"), 0.46);
  assert.equal(deviceSpeechRate("normal"), 0.54);
  assert.equal(deviceSpeechRate("fast"), 0.62);
});
