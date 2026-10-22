import assert from "node:assert/strict";
import test from "node:test";
import { appendExpoAudioFile } from "../src/voice-upload";

class RecordingFormData {
  parts: Array<[string, unknown, string | undefined]> = [];
  append(name: string, value: unknown, filename?: string) {
    this.parts.push([name, value, filename]);
  }
}

test("iOS Expo multipart upload declares a verified M4A recording as audio/mp4", async () => {
  const form = new RecordingFormData();
  const file = {
    exists: true,
    size: 128,
    name: "recording.m4a",
    type: "audio/m4a",
    bytes: async () => new Uint8Array([1, 2]),
  };
  appendExpoAudioFile(form as unknown as FormData, file);
  const [field, part, filename] = form.parts[0] ?? [];
  assert.equal(field, "audio");
  assert.equal(filename, undefined);
  assert.deepEqual(
    {
      name: (part as { name: string }).name,
      type: (part as { type: string }).type,
      bytes: await (part as { bytes(): Promise<Uint8Array> }).bytes(),
    },
    {
      name: "leadloop-voice-turn.m4a",
      type: "audio/mp4",
      bytes: new Uint8Array([1, 2]),
    },
  );
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
