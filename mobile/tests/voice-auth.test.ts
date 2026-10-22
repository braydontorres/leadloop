import assert from "node:assert/strict";
import test from "node:test";
import { mobileVoiceAuthorizationHeaders } from "../src/voice-auth";
import { cloudDiagnostic } from "../src/cloud-diagnostics";
import { voiceHttpError } from "../src/voice-response";

test("voice uploads build a Fetch-standard Authorization header", () => {
  const headers = mobileVoiceAuthorizationHeaders("session-token");
  assert.equal(headers.get("authorization"), "Bearer session-token");
});

test("voice authentication diagnostics retain only the safe server category", () => {
  const diagnostic = cloudDiagnostic(
    "voice_upload",
    voiceHttpError({
      message: "Your sign-in session was rejected.",
      code: "MOBILE_AUTH_TOKEN_REJECTED",
    }),
  );
  assert.deepEqual(diagnostic, {
    operation: "voice_upload",
    code: "MOBILE_AUTH_TOKEN_REJECTED",
    kind: "authentication",
    outcome: "failed",
  });
});

test("a missing mobile Authorization header remains an authentication diagnostic", () => {
  const diagnostic = cloudDiagnostic(
    "voice_upload",
    voiceHttpError({
      message: "LeadLoop did not receive a sign-in authorization.",
      code: "MOBILE_AUTH_HEADER_MISSING",
    }),
  );
  assert.equal(diagnostic.kind, "authentication");
  assert.equal(diagnostic.code, "MOBILE_AUTH_HEADER_MISSING");
});
