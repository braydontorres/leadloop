import assert from "node:assert/strict";
import test from "node:test";
import { GET } from "../app/api/health/route";

test("health endpoint reports only API liveness and prevents caching", async () => {
  const previousKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "must-not-appear-in-health-response";
  try {
    const response = GET();
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), {
      status: "ok",
      service: "leadloop-api",
    });
  } finally {
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
  }
});
