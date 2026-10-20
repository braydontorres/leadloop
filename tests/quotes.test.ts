import assert from "node:assert/strict";
import { test } from "node:test";
import {
  advanceQuoteMemory,
  emptyQuoteMemoryState,
  migrateQuotes,
  parseUsdCents,
  quoteForReminder,
  quotesForCustomer,
  saveQuote,
  type Quote,
} from "../lib/quotes";
import { migrateStore, type Person } from "../lib/tasks";

const now = new Date("2026-10-20T12:00:00.000Z");
let next = 0;
const id = () => `quote-test-${++next}`;
const mike: Person = {
  id: "mike-1",
  name: "Mike",
  business: "",
  email: "",
  phone: "",
  address: "",
  notes: "",
  interactions: [],
  createdAt: now.toISOString(),
  updatedAt: now.toISOString(),
};

const quote = (overrides: Partial<Quote> = {}): Quote => ({
  id: id(),
  customerId: mike.id,
  serviceDescription: "Driveway cleaning",
  amountCents: 25_000,
  currency: "USD",
  status: "draft",
  notes: "",
  createdAt: now.toISOString(),
  updatedAt: now.toISOString(),
  statusHistory: [],
  ...overrides,
});

test("USD amounts retain cents and reject missing, negative, and unreasonably large amounts", () => {
  assert.equal(parseUsdCents("$250"), 25_000);
  assert.equal(parseUsdCents("USD 250.05"), 25_005);
  assert.equal(parseUsdCents("250 dollars"), 25_000);
  assert.equal(parseUsdCents("$0"), null);
  assert.equal(parseUsdCents("$1000001"), null);
});

test("quote creation, correction, cancellation, and confirmation write once", () => {
  const first = advanceQuoteMemory({
    state: emptyQuoteMemoryState(),
    text: "Create a $250 driveway cleaning estimate for Mike.",
    people: [mike],
    quotes: [],
    createId: id,
    now,
  });
  assert.equal(first.handled, true);
  assert.equal(first.state.pending?.quote.amountCents, 25_000);
  assert.equal(first.savedQuote, undefined);

  const corrected = advanceQuoteMemory({
    state: first.state,
    text: "Actually, make it $275.50.",
    people: [mike],
    quotes: [],
    createId: id,
    now,
  });
  assert.equal(corrected.state.pending?.quote.amountCents, 27_550);
  const canceled = advanceQuoteMemory({
    state: corrected.state,
    text: "Cancel",
    people: [mike],
    quotes: [],
    createId: id,
    now,
  });
  assert.equal(canceled.savedQuote, undefined);

  const confirmed = advanceQuoteMemory({
    state: corrected.state,
    text: "Yes",
    people: [mike],
    quotes: [],
    createId: id,
    now,
  });
  const saved = saveQuote([], confirmed.savedQuote!);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].amountCents, 27_550);
  assert.equal(
    advanceQuoteMemory({
      state: confirmed.state,
      text: "Yes",
      people: [mike],
      quotes: saved,
      createId: id,
      now,
    }).savedQuote,
    undefined,
  );
});

test("spoken dollar wording and an explicit handoff create a sent estimate only after confirmation", () => {
  const proposed = advanceQuoteMemory({
    state: emptyQuoteMemoryState(),
    text: "I gave Mike a 250 dollars driveway cleaning estimate.",
    people: [mike],
    quotes: [],
    createId: id,
    now,
  });
  assert.equal(proposed.state.pending?.quote.amountCents, 25_000);
  assert.equal(proposed.state.pending?.quote.status, "sent");
  assert.equal(proposed.savedQuote, undefined);
});

test("quote status changes require confirmation and preserve customer and quote IDs", () => {
  const original = quote({ status: "sent" });
  const proposed = advanceQuoteMemory({
    state: emptyQuoteMemoryState(),
    text: "Mike accepted the driveway cleaning estimate.",
    people: [mike],
    quotes: [original],
    createId: id,
    now,
  });
  assert.equal(proposed.state.pending?.quote.id, original.id);
  assert.equal(proposed.state.pending?.quote.customerId, mike.id);
  assert.equal(proposed.state.pending?.quote.status, "accepted");
  const confirmed = advanceQuoteMemory({
    state: proposed.state,
    text: "Correct",
    people: [mike],
    quotes: [original],
    createId: id,
    now,
  });
  assert.equal(confirmed.savedQuote?.status, "accepted");
  assert.equal(confirmed.savedQuote?.statusHistory.at(-1)?.from, "sent");

  const declined = advanceQuoteMemory({
    state: emptyQuoteMemoryState(),
    text: "Mike declined the driveway cleaning estimate.",
    people: [mike],
    quotes: [confirmed.savedQuote!],
    createId: id,
    now,
  });
  assert.equal(declined.state.pending?.quote.status, "declined");
});

test("multiple matching estimates ask for the service, and retrieval only returns stored facts", () => {
  const driveway = quote();
  const patio = quote({ serviceDescription: "Patio cleaning" });
  const ambiguous = advanceQuoteMemory({
    state: emptyQuoteMemoryState(),
    text: "Mike accepted the estimate.",
    people: [mike],
    quotes: [driveway, patio],
    createId: id,
    now,
  });
  assert.match(ambiguous.reply, /more than one estimate/);
  const selected = advanceQuoteMemory({
    state: ambiguous.state,
    text: "Patio cleaning",
    people: [mike],
    quotes: [driveway, patio],
    createId: id,
    now,
  });
  assert.equal(selected.state.pending?.quote.id, patio.id);
  const retrieval = advanceQuoteMemory({
    state: emptyQuoteMemoryState(),
    text: "What estimates do I have for Mike?",
    people: [mike],
    quotes: [driveway],
    createId: id,
    now,
  });
  assert.match(retrieval.reply, /Driveway cleaning/);
  assert.match(retrieval.reply, /\$250.00/);
});

test("duplicate customer names are never used to create or update a quote", () => {
  const duplicateMike = { ...mike, id: "mike-2" };
  const response = advanceQuoteMemory({
    state: emptyQuoteMemoryState(),
    text: "Create a $250 driveway cleaning estimate for Mike.",
    people: [mike, duplicateMike],
    quotes: [],
    createId: id,
    now,
  });
  assert.match(response.reply, /more than one customer/);
  assert.equal(response.state.pending, null);
});

test("quote-linked reminders require one matching customer quote", () => {
  const driveway = quote();
  assert.equal(
    quoteForReminder({
      quotes: [driveway],
      customerId: mike.id,
      title: "Call Mike about the driveway estimate",
      notes: "",
    })?.id,
    driveway.id,
  );
  assert.equal(
    quoteForReminder({
      quotes: [driveway, quote({ serviceDescription: "Driveway sealing" })],
      customerId: mike.id,
      title: "Call Mike about the driveway estimate",
      notes: "",
    }),
    null,
  );
});

test("old local data migrates with an empty quote collection and exports quote records", () => {
  const migrated = migrateStore(
    {
      name: "Owner",
      business: "",
      timezone: "America/Chicago",
      workingDays: [1, 2, 3, 4, 5],
      tasks: [],
      people: [mike],
    },
    now.toISOString(),
  );
  assert.deepEqual(migrated.quotes, []);
  const stored = migrateQuotes([quote()], now.toISOString());
  assert.equal(stored.length, 1);
  assert.equal(quotesForCustomer(stored, mike.id).length, 1);
});
