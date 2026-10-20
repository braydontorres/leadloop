import type { CustomerInteraction, Person } from "./tasks";

export type CustomerFields = {
  name: string | null;
  phone: string | null;
  email: string | null;
  business: string | null;
  address: string | null;
  note: string | null;
};

export type CustomerOperation = "create" | "update" | "note";

export type CustomerDraft = {
  operation: CustomerOperation;
  person: Person;
  changed: Array<keyof CustomerFields>;
};

export type CustomerMemoryState = {
  pending: CustomerDraft | null;
  choice: { intent: CustomerIntent; people: Person[] } | null;
};

export type CustomerIntent =
  | { kind: "retrieve"; name: string }
  | {
      kind: "write";
      operation: CustomerOperation;
      name: string;
      fields: CustomerFields;
    };

export type CustomerMemoryTransition = {
  handled: boolean;
  state: CustomerMemoryState;
  reply: string;
  savedPerson?: Person;
};

const emptyFields = (): CustomerFields => ({
  name: null,
  phone: null,
  email: null,
  business: null,
  address: null,
  note: null,
});

export function emptyCustomerMemoryState(): CustomerMemoryState {
  return { pending: null, choice: null };
}

function normalized(value: string) {
  return value.trim().toLocaleLowerCase().replace(/\s+/g, " ");
}

function titleCase(value: string) {
  return value
    .trim()
    .split(/\s+/)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}

function clean(value: string | undefined) {
  return value?.trim().replace(/[.]+$/, "") || null;
}

function extractFields(text: string): CustomerFields {
  const fields = emptyFields();
  const name = text.match(
    /\b(?:preferred )?name\s*(?:is|:)?\s*([A-Za-z][A-Za-z' -]{0,80})/i,
  );
  const phone = text.match(
    /\b(?:phone(?: number)?|number)\s*(?:is|:)?\s*([+()\d][+()\d\s.-]{6,}[\d])/i,
  );
  const email = text.match(
    /\b(?:email|e-mail)\s*(?:is|:)?\s*([\w.+-]+@[\w.-]+\.[A-Za-z]{2,})/i,
  );
  const business = text.match(/\b(?:business|company)\s*(?:is|:)?\s*([^.;]+)/i);
  const address = text.match(/\baddress\s*(?:is|:)?\s*([^.;]+)/i);
  fields.name = clean(name?.[1]);
  fields.phone = clean(phone?.[1]);
  fields.email = clean(email?.[1]);
  fields.business = clean(business?.[1]);
  fields.address = clean(address?.[1]);
  return fields;
}

function personMatches(people: Person[], name: string) {
  const query = normalized(name);
  const exact = people.filter((person) => normalized(person.name) === query);
  if (exact.length) return exact;
  return people.filter((person) => normalized(person.name).includes(query));
}

export type CustomerLookup =
  | { kind: "none" }
  | { kind: "one"; person: Person }
  | { kind: "ambiguous"; people: Person[] };

export function findCustomer(people: Person[], name: string): CustomerLookup {
  const matches = personMatches(people, name);
  if (matches.length === 1) return { kind: "one", person: matches[0] };
  if (!matches.length) return { kind: "none" };
  return { kind: "ambiguous", people: matches };
}

export function customerNames(people: Person[]) {
  return people.map((person) => person.name).join(", ");
}

function ambiguityReply(matches: Person[]) {
  return `I found more than one customer: ${customerNames(matches)}. Which one do you mean?`;
}

function personSummary(person: Person) {
  const facts = [
    person.business && `business: ${person.business}`,
    person.phone && `phone: ${person.phone}`,
    person.email && `email: ${person.email}`,
    person.address && `address: ${person.address}`,
    person.notes && `notes: ${person.notes}`,
  ].filter(Boolean);
  const latest = person.interactions.at(-1)?.note;
  if (latest && latest !== person.notes) facts.push(`latest note: ${latest}`);
  return facts.length
    ? `Here’s what I have for ${person.name}: ${facts.join("; ")}.`
    : `I have a customer record for ${person.name}, but no details yet.`;
}

function operationLabel(draft: CustomerDraft) {
  if (draft.operation === "create")
    return `add ${draft.person.name} as a customer`;
  if (draft.operation === "note")
    return `add this note for ${draft.person.name}`;
  return `update ${draft.person.name}'s information`;
}

function readBack(draft: CustomerDraft) {
  const values = draft.changed
    .map((field) => {
      if (field === "note")
        return draft.person.notes ? `note: ${draft.person.notes}` : null;
      const value = draft.person[field];
      return typeof value === "string" && value ? `${field}: ${value}` : null;
    })
    .filter(Boolean);
  return `I’ll ${operationLabel(draft)}${values.length ? ` — ${values.join(", ")}` : ""}. Is that correct?`;
}

function interaction(
  note: string,
  now: string,
  id: string,
): CustomerInteraction {
  return { id, note, createdAt: now };
}

function mergeDraft(
  person: Person,
  fields: CustomerFields,
  operation: CustomerOperation,
  now: string,
  createId: () => string,
) {
  const changed: Array<keyof CustomerFields> = [];
  const update = (
    field: "name" | "phone" | "email" | "business" | "address",
    value: string | null,
  ) => {
    if (!value || person[field] === value) return;
    person[field] = value;
    changed.push(field);
  };
  update("name", fields.name);
  update("phone", fields.phone);
  update("email", fields.email);
  update("business", fields.business);
  update("address", fields.address);
  if (fields.note) {
    person.notes = person.notes
      ? `${person.notes}\n${fields.note}`
      : fields.note;
    person.interactions = [
      ...person.interactions,
      interaction(fields.note, now, createId()),
    ];
    changed.push("note");
  }
  person.updatedAt = now;
  return { operation, person, changed } satisfies CustomerDraft;
}

function nameFrom(text: string, expression: RegExp) {
  const match = text.match(expression);
  return clean(match?.[1]);
}

export function parseCustomerMemoryText(text: string): CustomerIntent | null {
  if (/\bremind me\b/i.test(text)) return null;
  const retrieve = nameFrom(
    text,
    /\b(?:what do i know about|tell me about|show me|lookup)\s+([^?.!]+)/i,
  );
  if (retrieve) return { kind: "retrieve", name: retrieve };

  const updateName = nameFrom(
    text,
    /\bupdate\s+([^.,!]+?)(?:'s\s+information|\s+information|[.,!]|$)/i,
  );
  if (updateName)
    return {
      kind: "write",
      operation: "update",
      name: updateName,
      fields: extractFields(text),
    };

  const remembered = text.match(
    /^\s*remember\s+that\s+(.+?)\s+((?:wants|needs|said|has)\b.+)$/i,
  );
  if (remembered) {
    const fields = extractFields(text);
    fields.name = titleCase(remembered[1]);
    fields.note = clean(remembered[2]);
    return { kind: "write", operation: "create", name: fields.name, fields };
  }

  const said = text.match(/^\s*(.+?)\s+((?:said|wants|needs)\b.+)$/i);
  if (said) {
    const fields = extractFields(text);
    fields.name = titleCase(said[1]);
    fields.note = clean(`${said[1]} ${said[2]}`);
    return { kind: "write", operation: "note", name: fields.name, fields };
  }
  return null;
}

function unchangedPendingReply() {
  return "Please say yes to save that customer change, or cancel to discard it.";
}

function selectedCustomer(people: Person[], answer: string) {
  const query = normalized(
    answer.replace(/^(?:it'?s|it is|the one called)\s+/i, ""),
  );
  const exact = people.filter((person) => normalized(person.name) === query);
  if (exact.length === 1) return exact[0];
  const partial = people.filter((person) =>
    normalized(person.name).includes(query),
  );
  return partial.length === 1 ? partial[0] : null;
}

function writeTransition(
  intent: Extract<CustomerIntent, { kind: "write" }>,
  existing: Person | null,
  state: CustomerMemoryState,
  now: string,
  createId: () => string,
): CustomerMemoryTransition {
  if (intent.operation === "update" && !existing)
    return {
      handled: true,
      state,
      reply: `I couldn’t find a customer named ${intent.name}. Add them first, then I can update their information.`,
    };
  const operation: CustomerOperation = existing
    ? intent.operation === "create"
      ? "note"
      : intent.operation
    : "create";
  const base: Person = existing
    ? { ...existing, interactions: [...existing.interactions] }
    : {
        id: createId(),
        name: titleCase(intent.name),
        business: "",
        email: "",
        phone: "",
        address: "",
        notes: "",
        interactions: [],
        createdAt: now,
        updatedAt: now,
      };
  const pending = mergeDraft(base, intent.fields, operation, now, createId);
  if (!pending.changed.length && operation !== "create")
    return {
      handled: true,
      state,
      reply: `I didn’t hear a customer detail to change for ${base.name}.`,
    };
  return {
    handled: true,
    state: { pending, choice: null },
    reply: readBack(pending),
  };
}

/**
 * Handles customer facts locally. It deliberately returns `handled: false` for
 * reminder language so the existing CalendarExpression conversation owns it.
 */
export function advanceCustomerMemory(args: {
  state: CustomerMemoryState;
  text: string;
  people: Person[];
  createId: () => string;
  now?: Date;
}): CustomerMemoryTransition {
  const { state, text, people, createId } = args;
  const now = (args.now ?? new Date()).toISOString();
  const user = text.trim();
  if (!user) return { handled: false, state, reply: "" };

  if (state.pending) {
    if (/^(?:yes|yeah|yep|correct|that'?s right|confirm)\b/i.test(user))
      return {
        handled: true,
        state: emptyCustomerMemoryState(),
        reply: `${state.pending.person.name}'s information is saved on this device. Anything else?`,
        savedPerson: state.pending.person,
      };
    if (/^(?:cancel|never mind|no,? cancel)\b/i.test(user))
      return {
        handled: true,
        state: emptyCustomerMemoryState(),
        reply: "Okay, I discarded that customer change.",
      };
    const fields = extractFields(user);
    if (Object.values(fields).some(Boolean)) {
      const pending = mergeDraft(
        {
          ...state.pending.person,
          interactions: [...state.pending.person.interactions],
        },
        fields,
        state.pending.operation,
        now,
        createId,
      );
      return {
        handled: true,
        state: { pending, choice: null },
        reply: readBack(pending),
      };
    }
    return { handled: true, state, reply: unchangedPendingReply() };
  }

  if (state.choice) {
    const selected = selectedCustomer(state.choice.people, user);
    if (!selected)
      return {
        handled: true,
        state,
        reply: ambiguityReply(state.choice.people),
      };
    if (state.choice.intent.kind === "retrieve")
      return {
        handled: true,
        state: emptyCustomerMemoryState(),
        reply: personSummary(selected),
      };
    return writeTransition(
      state.choice.intent,
      selected,
      emptyCustomerMemoryState(),
      now,
      createId,
    );
  }

  const intent = parseCustomerMemoryText(user);
  if (!intent) return { handled: false, state, reply: "" };
  if (intent.kind === "retrieve") {
    const lookup = findCustomer(people, intent.name);
    if (lookup.kind === "none")
      return {
        handled: true,
        state,
        reply: `I don’t have any information for ${intent.name} yet.`,
      };
    if (lookup.kind === "ambiguous")
      return {
        handled: true,
        state: { pending: null, choice: { intent, people: lookup.people } },
        reply: ambiguityReply(lookup.people),
      };
    return { handled: true, state, reply: personSummary(lookup.person) };
  }

  const lookup = findCustomer(people, intent.name);
  if (lookup.kind === "ambiguous")
    return {
      handled: true,
      state: { pending: null, choice: { intent, people: lookup.people } },
      reply: ambiguityReply(lookup.people),
    };
  return writeTransition(
    intent,
    lookup.kind === "one" ? lookup.person : null,
    state,
    now,
    createId,
  );
}

export function saveCustomer(people: Person[], person: Person) {
  return people.some((candidate) => candidate.id === person.id)
    ? people.map((candidate) =>
        candidate.id === person.id ? person : candidate,
      )
    : [...people, person];
}
