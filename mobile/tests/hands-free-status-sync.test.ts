import assert from "node:assert/strict";
import test from "node:test";
import { statusBelongsToActiveTurn } from "../src/hands-free-status-sync";

test("a status from the previous recorder turn cannot drive a new hands-free VAD", () => {
  assert.equal(statusBelongsToActiveTurn(1_000, 1_001), false);
  assert.equal(statusBelongsToActiveTurn(1_001, 1_001), true);
  assert.equal(statusBelongsToActiveTurn(null, 1_001), false);
  assert.equal(statusBelongsToActiveTurn(1_001, null), false);
});
