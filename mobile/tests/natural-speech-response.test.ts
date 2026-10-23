import assert from "node:assert/strict";
import test from "node:test";
import {
  isCurrentNaturalSpeechRequest,
  naturalSpeechDiagnosticSource,
  naturalSpeechFailureDetails,
  naturalSpeechFallbackNotice,
  naturalSpeechResponseMatchesSelection,
} from "../src/natural-speech-response";

function headers(values: Record<string, string>) {
  return {
    get(name: string) {
      return values[name.toLowerCase()] ?? null;
    },
  };
}

test("natural voice playback accepts only an exact server-marked voice and speed", () => {
  const selection = { voice: "onyx" as const, speed: "fast" as const };
  assert.equal(
    naturalSpeechResponseMatchesSelection(
      headers({
        "x-leadloop-speech-source": "openai-tts",
        "x-leadloop-speech-voice": "onyx",
        "x-leadloop-speech-speed": "fast",
      }),
      selection,
    ),
    true,
  );
  assert.equal(
    naturalSpeechResponseMatchesSelection(
      headers({
        "x-leadloop-speech-source": "openai-tts",
        "x-leadloop-speech-voice": "alloy",
        "x-leadloop-speech-speed": "fast",
      }),
      selection,
    ),
    false,
  );
  assert.equal(
    naturalSpeechResponseMatchesSelection(
      headers({
        "x-leadloop-speech-source": "openai-tts",
        "x-leadloop-speech-voice": "onyx",
        "x-leadloop-speech-speed": "normal",
      }),
      selection,
    ),
    false,
  );
});

test("a rapid new voice selection prevents an older preview from playing", () => {
  const firstPreview = 17;
  const secondPreview = 18;
  assert.equal(
    isCurrentNaturalSpeechRequest(firstPreview, secondPreview),
    false,
  );
  assert.equal(
    isCurrentNaturalSpeechRequest(secondPreview, secondPreview),
    true,
  );
});

test("failed Natural AI requests identify a safe failure stage before device fallback", () => {
  assert.deepEqual(
    naturalSpeechFailureDetails({
      name: "NaturalSpeechApiError",
      stage: "response",
      code: "AI_SPEECH_REJECTED",
    }),
    { stage: "response", code: "AI_SPEECH_REJECTED" },
  );
  assert.deepEqual(naturalSpeechFailureDetails(new Error("native failure")), {
    stage: "playback",
    code: "SPEECH_PLAYBACK_FAILED",
  });
});

test("natural voice diagnostics distinguish session, transport, download, and response failures", () => {
  for (const stage of [
    "session",
    "transport",
    "download",
    "response",
  ] as const) {
    assert.deepEqual(
      naturalSpeechFailureDetails({
        name: "NaturalSpeechApiError",
        stage,
        code: `SPEECH_${stage.toUpperCase()}_FAILED`,
      }),
      { stage, code: `SPEECH_${stage.toUpperCase()}_FAILED` },
    );
  }
});

test("rate-limit fallbacks distinguish LeadLoop and OpenAI with a retry time", () => {
  const local = naturalSpeechFailureDetails({
    name: "NaturalSpeechApiError",
    stage: "response",
    code: "LOCAL_RATE_LIMIT",
    retryAfterSeconds: 42,
  });
  assert.deepEqual(local, {
    stage: "response",
    code: "LOCAL_RATE_LIMIT",
    retryAfterSeconds: 42,
  });
  assert.equal(naturalSpeechDiagnosticSource(local), "LeadLoop rate limit");
  assert.match(naturalSpeechFallbackNotice(local), /42s/);
  assert.equal(
    naturalSpeechDiagnosticSource({
      stage: "response",
      code: "AI_RATE_LIMITED",
    }),
    "OpenAI rate limit",
  );
  assert.equal(
    naturalSpeechDiagnosticSource({
      stage: "transport",
      code: "SPEECH_NETWORK_ERROR",
    }),
    "Network transport",
  );
  assert.equal(
    naturalSpeechDiagnosticSource({
      stage: "playback",
      code: "SPEECH_PLAYBACK_FAILED",
    }),
    "Native playback",
  );
});
