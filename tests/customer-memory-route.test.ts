import assert from "node:assert/strict";
import { test } from "node:test";
import { POST } from "../app/api/customer-memory/route";

function request(text: unknown) {
  return new Request("http://leadloop.test/api/customer-memory", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
}

test("customer-memory route classifies a single customer utterance without receiving customer records", async () => {
  const response = await POST(
    request("Remember that Mike wants his driveway cleaned for $250."),
  );
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.handled, true);
  assert.equal(payload.operation.operation, "create");
  assert.equal(payload.operation.name, "Mike");
  assert.equal(
    payload.operation.fields.note,
    "wants his driveway cleaned for $250",
  );
});

test("customer-memory route rejects malformed input and leaves reminder language alone", async () => {
  assert.equal(
    (await POST(request("Remind me to call Mike next Friday at 3 PM."))).status,
    200,
  );
  const reminderPayload = await (
    await POST(request("Remind me to call Mike next Friday at 3 PM."))
  ).json();
  assert.equal(reminderPayload.handled, false);
  assert.equal((await POST(request(42))).status, 400);
});
