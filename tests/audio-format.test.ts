import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeAudioMimeType,
  selectRecorderMimeType,
  supportedAudioFormat,
} from "../lib/audio-format";
import { POST as voicePost } from "../app/api/voice/route";

test("recognizes Chrome WebM and Safari MP4 MIME parameters", () => {
  assert.equal(normalizeAudioMimeType("audio/webm;codecs=opus"), "audio/webm");
  assert.equal(
    supportedAudioFormat("audio/webm; codecs=opus")?.extension,
    "webm",
  );
  assert.equal(
    supportedAudioFormat("audio/mp4;codecs=mp4a.40.2")?.extension,
    "m4a",
  );
  assert.equal(
    supportedAudioFormat("video/mp4; codecs=mp4a.40.2")?.extension,
    "m4a",
  );
});

test("chooses the first browser-supported recorder format", () => {
  assert.equal(
    selectRecorderMimeType((type) => type === "audio/webm;codecs=opus"),
    "audio/webm;codecs=opus",
  );
  assert.equal(
    selectRecorderMimeType((type) => type === "audio/mp4"),
    "audio/mp4",
  );
  assert.equal(
    selectRecorderMimeType(() => false),
    null,
  );
});

test("does not allow arbitrary audio formats", () => {
  assert.equal(supportedAudioFormat("audio/flac"), null);
  assert.equal(supportedAudioFormat("application/octet-stream"), null);
  assert.equal(supportedAudioFormat(""), null);
});

function voiceRequest(mimeType: string) {
  const form = new FormData();
  form.append(
    "audio",
    new Blob(["short audio"], { type: mimeType }),
    "leadloop-recording.webm",
  );
  form.append("timeZone", "America/Chicago");
  form.append("context", JSON.stringify({}));
  return new Request("http://leadloop.test/api/voice", {
    method: "POST",
    body: form,
  });
}

test("accepts a codec-qualified supported upload before checking OpenAI credentials", async () => {
  const previous = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    const response = await voicePost(voiceRequest("audio/webm;codecs=opus"));
    assert.equal(response.status, 503);
    assert.equal(
      ((await response.json()) as { code: string }).code,
      "AI_NOT_CONFIGURED",
    );
  } finally {
    if (previous === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previous;
  }
});

test("rejects an unsupported upload with a 415 response", async () => {
  const response = await voicePost(voiceRequest("audio/flac"));
  assert.equal(response.status, 415);
  assert.equal(
    ((await response.json()) as { code: string }).code,
    "AUDIO_UNSUPPORTED",
  );
});
