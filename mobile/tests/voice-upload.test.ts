import assert from "node:assert/strict";
import test from "node:test";
import { appendExpoAudioFile } from "../src/voice-upload";

class RecordingFormData {
  parts: Array<[string, unknown, string | undefined]> = [];
  append(name: string, value: unknown, filename?: string) {
    this.parts.push([name, value, filename]);
  }
}

test("Expo-compatible audio upload uses a bytes-capable file and an m4a filename", () => {
  const form = new RecordingFormData();
  const file = {
    exists: true,
    size: 128,
    name: "recording.m4a",
    type: "audio/m4a",
    bytes: async () => new Uint8Array([1, 2]),
  };
  appendExpoAudioFile(form as unknown as FormData, file);
  assert.deepEqual(form.parts[0], ["audio", file, "leadloop-voice-turn.m4a"]);
});

test("legacy React Native uri objects are rejected before multipart upload", () => {
  const form = new RecordingFormData();
  assert.throws(
    () =>
      appendExpoAudioFile(
        form as unknown as FormData,
        {
          exists: true,
          size: 128,
          name: "recording.m4a",
          type: "audio/m4a",
          uri: "file:///recording.m4a",
        } as never,
      ),
    /cannot be uploaded/i,
  );
  assert.equal(form.parts.length, 0);
});

test("missing or empty recording files are rejected without sending a request", () => {
  const form = new RecordingFormData();
  assert.throws(
    () =>
      appendExpoAudioFile(form as unknown as FormData, {
        exists: false,
        size: 0,
        name: "recording.m4a",
        type: "audio/m4a",
        bytes: async () => new Uint8Array(),
      }),
    /unavailable/i,
  );
  assert.equal(form.parts.length, 0);
});
