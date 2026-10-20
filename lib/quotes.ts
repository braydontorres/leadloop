import type { Person } from "./tasks";

export const QUOTE_STATUSES = [
  "draft",
  "sent",
  "accepted",
  "declined",
] as const;
export type QuoteStatus = (typeof QUOTE_STATUSES)[number];

export type QuoteStatusChange = {
  id: string;
  from: QuoteStatus | null;
  to: QuoteStatus;
  changedAt: string;
};

export type Quote = {
  id: string;
  customerId: string;
  serviceDescription: string;
  amountCents: number;
  currency: "USD";
  status: QuoteStatus;
  notes: string;
  createdAt: string;
  updatedAt: string;
  statusHistory: QuoteStatusChange[];
};

export type QuoteDraft = {
  quote: Quote;
  operation: "create" | "update" | "status";
};

export type QuoteMemoryState = {
  pending: QuoteDraft | null;
  choice: { customer: Person; quotes: Quote[]; status: QuoteStatus } | null;
};

export type QuoteTransition = {
  handled: boolean;
  state: QuoteMemoryState;
  reply: string;
  savedQuote?: Quote;
};

const MAX_QUOTE_CENTS = 100_000_000;

export function emptyQuoteMemoryState(): QuoteMemoryState {
  return { pending: null, choice: null };
}

function normalized(value: string) {
  return value.trim().toLocaleLowerCase().replace(/\s+/g, " ");
}

function title(value: string) {
  return value
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\s+(?:estimate|quote)$/i, "")
    .replace(/^\w/, (letter) => letter.toUpperCase());
}

export function quoteAmountLabel(amountCents: number, currency = "USD") {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  }).format(amountCents / 100);
}

/** Parses only explicit USD amounts, retaining cents exactly. */
export function parseUsdCents(value: string): number | null {
  const match = value.match(
    /(?:\$\s*|\bUSD\s*)(\d{1,7})(?:\.(\d{1,2}))?\b|\b(\d{1,7})(?:\.(\d{1,2}))?\s+dollars?\b/i,
  );
  if (!match) return null;
  const dollars = Number(match[1] ?? match[3]);
  const cents = Number((match[2] ?? match[4] ?? "").padEnd(2, "0") || "0");
  const total = dollars * 100 + cents;
  return Number.isSafeInteger(total) && total > 0 && total <= MAX_QUOTE_CENTS
    ? total
    : null;
}

export function validQuoteAmount(amountCents: number) {
  return (
    Number.isSafeInteger(amountCents) &&
    amountCents > 0 &&
    amountCents <= MAX_QUOTE_CENTS
  );
}

function quoteStatus(value: unknown): QuoteStatus {
  return QUOTE_STATUSES.includes(value as QuoteStatus)
    ? (value as QuoteStatus)
    : "draft";
}

export function migrateQuotes(value: unknown, now: string): Quote[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const quote = entry as Record<string, unknown>;
    if (
      typeof quote.id !== "string" ||
      !quote.id ||
      typeof quote.customerId !== "string" ||
      !quote.customerId ||
      typeof quote.serviceDescription !== "string" ||
      !quote.serviceDescription.trim() ||
      typeof quote.amountCents !== "number" ||
      !validQuoteAmount(quote.amountCents)
    )
      return [];
    const createdAt =
      typeof quote.createdAt === "string" &&
      !Number.isNaN(Date.parse(quote.createdAt))
        ? quote.createdAt
        : now;
    const status = quoteStatus(quote.status);
    return [
      {
        id: quote.id,
        customerId: quote.customerId,
        serviceDescription: quote.serviceDescription.trim().slice(0, 240),
        amountCents: quote.amountCents,
        currency: "USD" as const,
        status,
        notes:
          typeof quote.notes === "string" ? quote.notes.slice(0, 1000) : "",
        createdAt,
        updatedAt:
          typeof quote.updatedAt === "string" &&
          !Number.isNaN(Date.parse(quote.updatedAt))
            ? quote.updatedAt
            : createdAt,
        statusHistory: Array.isArray(quote.statusHistory)
          ? quote.statusHistory.flatMap((change) => {
              if (!change || typeof change !== "object") return [];
              const record = change as Record<string, unknown>;
              const to = quoteStatus(record.to);
              return typeof record.id === "string" &&
                typeof record.changedAt === "string" &&
                !Number.isNaN(Date.parse(record.changedAt))
                ? [
                    {
                      id: record.id,
                      from: QUOTE_STATUSES.includes(record.from as QuoteStatus)
                        ? (record.from as QuoteStatus)
                        : null,
                      to,
                      changedAt: record.changedAt,
                    },
                  ]
                : [];
            })
          : [],
      },
    ];
  });
}

export function saveQuote(quotes: Quote[], quote: Quote) {
  if (!quote.customerId)
    throw new Error("Choose a customer for this estimate.");
  if (!quote.serviceDescription.trim())
    throw new Error("Describe the service for this estimate.");
  if (!validQuoteAmount(quote.amountCents))
    throw new Error("Enter a valid estimate between $0.01 and $1,000,000.");
  return quotes.some((candidate) => candidate.id === quote.id)
    ? quotes.map((candidate) => (candidate.id === quote.id ? quote : candidate))
    : [...quotes, quote];
}

function matchingCustomers(people: Person[], name: string) {
  const query = normalized(name);
  const exact = people.filter((person) => normalized(person.name) === query);
  return exact.length
    ? exact
    : people.filter((person) => normalized(person.name).includes(query));
}

function findCustomer(people: Person[], name: string) {
  const matches = matchingCustomers(people, name);
  return matches.length === 1 ? matches[0] : null;
}

function customerLookupReply(people: Person[], name: string) {
  const matches = matchingCustomers(people, name);
  return matches.length > 1
    ? `I found more than one customer named ${name.trim()}. Which one do you mean?`
    : `I couldn’t identify one customer named ${name.trim()}.`;
}

function quoteMatchesDescription(quote: Quote, description: string) {
  const words = normalized(description)
    .split(/[^a-z0-9]+/)
    .filter(
      (word) =>
        word.length > 2 &&
        !["estimate", "quote", "the", "his", "her"].includes(word),
    );
  return words.length
    ? words.some((word) => normalized(quote.serviceDescription).includes(word))
    : true;
}

function quoteReadback(draft: QuoteDraft, people: Person[]) {
  const customer = people.find(
    (person) => person.id === draft.quote.customerId,
  );
  const verb =
    draft.operation === "create"
      ? "create"
      : draft.operation === "status"
        ? "mark"
        : "update";
  return `I’ll ${verb} the ${quoteAmountLabel(draft.quote.amountCents)} ${draft.quote.serviceDescription} estimate for ${customer?.name ?? "that customer"} as ${draft.quote.status}. Is that correct?`;
}

function statusFromText(text: string): QuoteStatus | null {
  if (/\baccepted\b/i.test(text)) return "accepted";
  if (/\bdeclined\b|\brejected\b/i.test(text)) return "declined";
  if (/\bsent\b|\bgave\b|\bdelivered\b/i.test(text)) return "sent";
  if (/\bdraft\b/i.test(text)) return "draft";
  return null;
}

function createQuote(
  customer: Person,
  serviceDescription: string,
  amountCents: number,
  status: QuoteStatus,
  now: string,
  createId: () => string,
): Quote {
  return {
    id: createId(),
    customerId: customer.id,
    serviceDescription: title(serviceDescription),
    amountCents,
    currency: "USD",
    status,
    notes: "",
    createdAt: now,
    updatedAt: now,
    statusHistory: [{ id: createId(), from: null, to: status, changedAt: now }],
  };
}

function changedStatus(
  quote: Quote,
  status: QuoteStatus,
  now: string,
  createId: () => string,
) {
  if (quote.status === status) return quote;
  return {
    ...quote,
    status,
    updatedAt: now,
    statusHistory: [
      ...quote.statusHistory,
      { id: createId(), from: quote.status, to: status, changedAt: now },
    ],
  };
}

function customerAndService(text: string) {
  const creation = text.match(
    /(?:create|make|add)\s+(?:a\s+)?(?:\$\s*|USD\s*)?\d+(?:\.\d{1,2})?(?:\s+dollars?)?\s+(.+?)\s+(?:estimate|quote)\s+for\s+([A-Za-z][A-Za-z' -]{0,80})[.!]?$|(?:gave|give)\s+([A-Za-z][A-Za-z' -]{0,80})\s+(?:a\s+)?(?:\$\s*|USD\s*)?\d+(?:\.\d{1,2})?(?:\s+dollars?)?\s+(.+?)\s+(?:estimate|quote)/i,
  );
  if (!creation) return null;
  return {
    service: (creation[1] ?? creation[4] ?? "").trim(),
    name: (creation[2] ?? creation[3] ?? "").replace(/\s+a$/i, "").trim(),
  };
}

function statusRequest(text: string) {
  const customerFirst = text.match(
    /^\s*([A-Za-z][A-Za-z' -]{0,80}?)\s+(accepted|declined|rejected)\s+(?:the\s+)?(.+?)\s+(?:estimate|quote)[.!]?$/i,
  );
  if (customerFirst)
    return {
      status: statusFromText(customerFirst[2])!,
      name: customerFirst[1].trim(),
      description: customerFirst[3].trim(),
    };
  const senderFirst = text.match(
    /^\s*(?:I\s+)?(sent|gave)\s+([A-Za-z][A-Za-z' -]{0,80}?)\s+(?:his|her|the)\s+(.+?)\s+(?:estimate|quote)[.!]?$/i,
  );
  return senderFirst
    ? {
        status: statusFromText(senderFirst[1])!,
        name: senderFirst[2].trim(),
        description: senderFirst[3].trim(),
      }
    : null;
}

function quoteSummary(quotes: Quote[]) {
  return quotes.length
    ? `For this customer I have: ${quotes.map((quote) => `${quote.serviceDescription} — ${quoteAmountLabel(quote.amountCents)} (${quote.status})`).join("; ")}.`
    : "I don’t have any estimates for that customer yet.";
}

/**
 * Local, deterministic quote conversation handler. It receives only the
 * current utterance plus the browser's customer and quote records.
 */
export function advanceQuoteMemory(args: {
  state: QuoteMemoryState;
  text: string;
  people: Person[];
  quotes: Quote[];
  createId: () => string;
  now?: Date;
}): QuoteTransition {
  const { state, text, people, quotes, createId } = args;
  const now = (args.now ?? new Date()).toISOString();
  const user = text.trim();
  if (!user) return { handled: false, state, reply: "" };

  if (state.pending) {
    if (/^(?:yes|yeah|yep|correct|that'?s right|confirm)\b/i.test(user))
      return {
        handled: true,
        state: emptyQuoteMemoryState(),
        reply: "Estimate saved on this device. Anything else?",
        savedQuote: state.pending.quote,
      };
    if (/^(?:cancel|never mind|no,? cancel)\b/i.test(user))
      return {
        handled: true,
        state: emptyQuoteMemoryState(),
        reply: "Okay, I discarded that estimate change.",
      };
    const amount = parseUsdCents(user);
    const status = statusFromText(user);
    if (amount || status) {
      const quote = {
        ...state.pending.quote,
        ...(amount ? { amountCents: amount } : {}),
        ...(status
          ? changedStatus(state.pending.quote, status, now, createId)
          : {}),
        updatedAt: now,
      };
      const pending: QuoteDraft = {
        quote,
        operation: amount ? "update" : "status",
      };
      return {
        handled: true,
        state: { pending, choice: null },
        reply: quoteReadback(pending, people),
      };
    }
    return {
      handled: true,
      state,
      reply:
        "Please say yes to save that estimate change, give the corrected amount, or cancel it.",
    };
  }

  if (state.choice) {
    const selected = state.choice.quotes.find((quote) =>
      normalized(user).includes(normalized(quote.serviceDescription)),
    );
    if (!selected)
      return {
        handled: true,
        state,
        reply: `I found more than one estimate for ${state.choice.customer.name}. Which service do you mean?`,
      };
    const quote = changedStatus(selected, state.choice.status, now, createId);
    const pending: QuoteDraft = { quote, operation: "status" };
    return {
      handled: true,
      state: { pending, choice: null },
      reply: quoteReadback(pending, people),
    };
  }

  const retrieval = user.match(
    /(?:what|show)\s+(?:estimates|quotes).+?for\s+([A-Za-z][A-Za-z' -]{0,80})[?!.]?$/i,
  );
  if (retrieval) {
    const customer = findCustomer(people, retrieval[1]);
    if (!customer)
      return {
        handled: true,
        state,
        reply: customerLookupReply(people, retrieval[1]),
      };
    return {
      handled: true,
      state,
      reply: quoteSummary(
        quotes.filter((quote) => quote.customerId === customer.id),
      ),
    };
  }

  const creation = customerAndService(user);
  if (creation) {
    const amount = parseUsdCents(user);
    const customer = findCustomer(people, creation.name);
    if (!amount)
      return {
        handled: true,
        state,
        reply: "What exact dollar amount should I put on that estimate?",
      };
    if (!customer)
      return {
        handled: true,
        state,
        reply: customerLookupReply(people, creation.name),
      };
    if (!creation.service)
      return {
        handled: true,
        state,
        reply: "What service is this estimate for?",
      };
    const quote = createQuote(
      customer,
      creation.service,
      amount,
      /\b(?:gave|sent)\b/i.test(user) ? "sent" : "draft",
      now,
      createId,
    );
    const pending: QuoteDraft = { quote, operation: "create" };
    return {
      handled: true,
      state: { pending, choice: null },
      reply: quoteReadback(pending, people),
    };
  }

  if (
    /\b(?:create|make|add)\b[\s\S]*\b(?:estimate|quote)\b[\s\S]*\bfor\b/i.test(
      user,
    )
  )
    return {
      handled: true,
      state,
      reply: "What exact dollar amount should I put on that estimate?",
    };

  const request = statusRequest(user);
  if (request) {
    const customer = findCustomer(people, request.name);
    if (!customer)
      return {
        handled: true,
        state,
        reply: customerLookupReply(people, request.name),
      };
    const matches = quotes.filter(
      (quote) =>
        quote.customerId === customer.id &&
        quoteMatchesDescription(quote, request.description),
    );
    if (!matches.length)
      return {
        handled: true,
        state,
        reply: `I couldn’t find a matching estimate for ${customer.name}.`,
      };
    if (matches.length > 1)
      return {
        handled: true,
        state: {
          pending: null,
          choice: { customer, quotes: matches, status: request.status },
        },
        reply: `I found more than one estimate for ${customer.name}. Which service do you mean?`,
      };
    const pending: QuoteDraft = {
      quote: changedStatus(matches[0], request.status, now, createId),
      operation: "status",
    };
    return {
      handled: true,
      state: { pending, choice: null },
      reply: quoteReadback(pending, people),
    };
  }

  return { handled: false, state, reply: "" };
}

export function quotesForCustomer(quotes: Quote[], customerId: string) {
  return quotes
    .filter((quote) => quote.customerId === customerId)
    .slice()
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export function quoteForReminder(args: {
  quotes: Quote[];
  customerId: string | undefined;
  title: string;
  notes: string;
}) {
  const matches = matchingQuotesForReminder(args);
  return matches.length === 1 ? matches[0] : null;
}

export function matchingQuotesForReminder(args: {
  quotes: Quote[];
  customerId: string | undefined;
  title: string;
  notes: string;
}) {
  if (!args.customerId) return [];
  return args.quotes.filter(
    (quote) =>
      quote.customerId === args.customerId &&
      quoteMatchesDescription(quote, `${args.title} ${args.notes}`),
  );
}
