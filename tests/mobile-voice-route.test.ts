import assert from "node:assert/strict";
import { test } from "node:test";
import { POST } from "../app/api/mobile/voice/route";

function request() {
  const form = new FormData();
  form.append("workspaceId", "11111111-1111-4111-8111-111111111111");
  form.append("durationMs", "200");
  form.append("timeZone", "America/Chicago");
  form.append("context", "{}");
  form.append("audio", new Blob(["audio"], { type: "audio/m4a" }), "voice.m4a");
  return new Request("https://leadloop.test/api/mobile/voice", {
    method: "POST",
    body: form,
  });
}

test("mobile voice rejects an unauthenticated upload before transcription", async () => {
  const response = await POST(request());
  assert.equal(response.status, 401);
  assert.equal((await response.json()).code, "MOBILE_AUTH_REQUIRED");
});
