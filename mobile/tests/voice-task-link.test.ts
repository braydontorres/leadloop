import assert from "node:assert/strict";
import test from "node:test";
import { linkVoiceTask } from "../src/voice-task-link";

const person = {
  id: "mike",
  name: "Mike",
  business: "",
  email: "",
  phone: "",
  address: "",
  notes: "",
  interactions: [],
  createdAt: "",
  updatedAt: "",
};
const task = {
  id: "task",
  title: "Call Mike about driveway estimate",
  person: "Mike",
  due: "2027-01-01T21:00:00.000Z",
  completed: false,
  notes: "",
};
const quote = {
  id: "quote",
  customerId: "mike",
  serviceDescription: "driveway cleaning",
  amountCents: 25000,
  currency: "USD" as const,
  status: "sent" as const,
  notes: "",
  createdAt: "",
  updatedAt: "",
  statusHistory: [],
};

test("voice reminder links only one matching customer and quote", () => {
  assert.deepEqual(
    linkVoiceTask(
      task,
      "Call Mike about his driveway cleaning estimate",
      [person],
      [quote],
    ),
    { ...task, person: "Mike", personId: "mike", quoteId: "quote" },
  );
});

test("duplicate customer names do not create an unsafe customer link", () => {
  const duplicate = { ...person, id: "mike-2" };
  assert.deepEqual(
    linkVoiceTask(
      task,
      "Call Mike about an estimate",
      [person, duplicate],
      [quote],
    ),
    task,
  );
});
