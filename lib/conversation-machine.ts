import { fromLocalInput, type Task } from "./tasks";
import {
  dateConstraintQuestion,
  deriveDateConstraint,
  deterministicDateFromText,
  isMeaningfulReminderTitle,
  mergeDateConstraints,
  matchesDateConstraint,
  mentionsExplicitTime,
  mentionsUnambiguousDate,
  resolveDateConstraint,
  type DateConstraint,
  type WeekdayOccurrence,
} from "./reminder-details";

export type ConversationStage =
  | "idle"
  | "listening"
  | "processing"
  | "awaiting_details"
  | "reading_back"
  | "awaiting_confirmation"
  | "saved"
  | "canceled"
  | "ended";

export type ActiveReminder = Pick<
  Task,
  "id" | "title" | "person" | "due" | "notes"
> & {
  pendingDate: string | null;
  pendingTime: string | null;
  pendingDateConstraint: DateConstraint | null;
};

export type IntentFields = {
  title: string | null;
  person: string | null;
  date: string | null;
  time: string | null;
  notes: string | null;
  clearDue: boolean;
};

export type AssistantIntent = {
  kind:
    | "new_task"
    | "follow_up"
    | "update"
    | "confirm"
    | "reject"
    | "cancel"
    | "end_conversation"
    | "none";
  fields: IntentFields;
};

export type IntentResult = { intent: AssistantIntent };

export type ConversationState = {
  stage: ConversationStage;
  activeReminder: ActiveReminder | null;
  lastSavedReminder: ActiveReminder | null;
  history: Array<{ role: "user" | "assistant"; text: string }>;
  // Kept empty while the page transitions away from the retired card renderer.
  drafts: any[];
  pending: any[];
  cancellationIds: string[];
  phase: string;
};

export type ConversationContext = {
  history: ConversationState["history"];
  activeReminder: ActiveReminder | null;
  stage: ConversationStage;
};

export type ConversationTransition = {
  state: ConversationState;
  reply: string;
  savedTask?: Task;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function text(
  value: unknown,
  label: string,
  maxLength: number,
  optional = false,
) {
  if (optional && value === "") return "";
  if (typeof value !== "string" || !value.trim() || value.length > maxLength)
    throw new Error(`Invalid ${label}.`);
  return value.trim();
}

function activeReminder(value: unknown): ActiveReminder | null {
  if (value === null || value === undefined) return null;
  if (!isRecord(value)) throw new Error("Invalid active reminder.");
  return {
    id: text(value.id, "reminder id", 120),
    title: text(value.title, "reminder title", 240, true),
    person: text(value.person, "person", 160, true),
    due: text(value.due, "reminder time", 80, true),
    notes: text(value.notes, "notes", 1000, true),
    pendingDate:
      value.pendingDate === undefined || value.pendingDate === null
        ? null
        : text(value.pendingDate, "pending reminder date", 10),
    pendingTime:
      value.pendingTime === undefined || value.pendingTime === null
        ? null
        : text(value.pendingTime, "pending reminder time", 5),
    pendingDateConstraint:
      value.pendingDateConstraint === undefined ||
      value.pendingDateConstraint === null
        ? null
        : dateConstraint(value.pendingDateConstraint),
  };
}

function dateConstraint(value: unknown): DateConstraint {
  if (!isRecord(value)) throw new Error("Invalid reminder date constraint.");
  const part = (
    name: "year" | "month" | "weekday",
    minimum: number,
    maximum: number,
  ) => {
    const current = value[name];
    if (current === null) return null;
    if (
      !Number.isInteger(current) ||
      (current as number) < minimum ||
      (current as number) > maximum
    )
      throw new Error("Invalid reminder date constraint.");
    return current as number;
  };
  return {
    year: part("year", 2000, 9999),
    month: part("month", 1, 12),
    weekday: part("weekday", 0, 6),
    occurrence: dateConstraintOccurrence(value.occurrence),
  };
}

function dateConstraintOccurrence(value: unknown): WeekdayOccurrence | null {
  if (value === undefined || value === null) return null;
  if (
    value === 1 ||
    value === 2 ||
    value === 3 ||
    value === 4 ||
    value === 5 ||
    value === "last" ||
    value === "second_to_last"
  )
    return value;
  throw new Error("Invalid reminder date constraint.");
}

export function parseConversationContext(value: unknown): ConversationContext {
  if (!isRecord(value)) throw new Error("Invalid conversation context.");
  const history = Array.isArray(value.history)
    ? value.history.slice(-8).map((turn) => {
        if (
          !isRecord(turn) ||
          (turn.role !== "user" && turn.role !== "assistant")
        )
          throw new Error("Invalid conversation history.");
        return {
          role: turn.role,
          text: text(turn.text, "conversation message", 1200),
        } as ConversationState["history"][number];
      })
    : [];
  const stages: ConversationStage[] = [
    "idle",
    "listening",
    "processing",
    "awaiting_details",
    "reading_back",
    "awaiting_confirmation",
    "saved",
    "canceled",
    "ended",
  ];
  if (
    value.stage !== undefined &&
    (typeof value.stage !== "string" ||
      !stages.includes(value.stage as ConversationStage))
  )
    throw new Error("Invalid conversation stage.");
  return {
    history,
    activeReminder: activeReminder(value.activeReminder),
    stage: (value.stage as ConversationStage | undefined) ?? "idle",
  };
}

export function emptyConversationState(): ConversationState {
  return {
    stage: "idle",
    activeReminder: null,
    lastSavedReminder: null,
    history: [],
    drafts: [],
    pending: [],
    cancellationIds: [],
    phase: "idle",
  };
}

/** A fresh session is only started after an explicit user action. */
export function startConversation(state: ConversationState): ConversationState {
  return {
    ...emptyConversationState(),
    lastSavedReminder: state.lastSavedReminder,
  };
}

export function isConversationEndingPhrase(
  user: string,
  stage: ConversationStage,
) {
  // "No" at a read-back means the reminder needs a correction, never goodbye.
  if (stage === "awaiting_confirmation" || stage === "reading_back")
    return false;
  return /^(?:that'?s all|no,? i'?m good|nothing else|we'?re done|bye|yeah,? that'?s everything)\b/i.test(
    user.trim(),
  );
}

function withHistory(
  state: ConversationState,
  user: string,
  assistant: string,
) {
  return [
    ...state.history,
    { role: "user" as const, text: user },
    { role: "assistant" as const, text: assistant },
  ].slice(-8);
}

function withReply(
  state: ConversationState,
  user: string,
  reply: string,
  updates: Partial<ConversationState>,
): ConversationTransition {
  return {
    state: {
      ...state,
      ...updates,
      history: withHistory(state, user, reply),
    },
    reply,
  };
}

function applyFields(
  current: ActiveReminder,
  fields: IntentFields,
  timeZone: string,
  dateConstraint: DateConstraint | null,
) {
  let due = fields.clearDue ? "" : current.due;
  let pendingDate = fields.clearDue ? null : current.pendingDate;
  let pendingTime = fields.clearDue ? null : current.pendingTime;
  let pendingDateConstraint = fields.clearDue
    ? null
    : current.pendingDateConstraint;
  let dateConstraintError: string | null = null;
  if (dateConstraint) {
    const mergedConstraint = mergeDateConstraints(
      pendingDateConstraint,
      dateConstraint,
    );
    if (!mergedConstraint) throw new Error("Invalid reminder date constraint.");
    pendingDateConstraint = mergedConstraint;
    pendingDate = null;
    due = "";
    const resolution = resolveDateConstraint(mergedConstraint);
    if (resolution.status === "resolved") {
      pendingDate = resolution.date;
      pendingDateConstraint = null;
    } else if (resolution.status === "unavailable") {
      const weekday = new Intl.DateTimeFormat("en-US", {
        weekday: "long",
        timeZone: "UTC",
      }).format(new Date(Date.UTC(2023, 0, 1 + mergedConstraint.weekday!)));
      const countWord =
        ["zero", "one", "two", "three", "four", "five"][
          resolution.occurrenceCount
        ] ?? String(resolution.occurrenceCount);
      const ordinalWord =
        ["zeroth", "first", "second", "third", "fourth", "fifth"][
          resolution.occurrenceCount
        ] ?? `${resolution.occurrenceCount}th`;
      dateConstraintError = `That month only has ${countWord} ${weekday}s. Would you like the ${ordinalWord} ${weekday} instead?`;
    }
  }
  if (fields.date !== null || fields.time !== null) {
    const previous = due
      ? new Intl.DateTimeFormat("en-CA", {
          timeZone,
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          hourCycle: "h23",
        }).formatToParts(new Date(due))
      : [];
    const part = (name: Intl.DateTimeFormatPartTypes) =>
      previous.find((entry) => entry.type === name)?.value ?? "";
    const dueDate = `${part("year")}-${part("month")}-${part("day")}`;
    const dueTime = `${part("hour")}:${part("minute")}`;
    if (
      fields.date !== null &&
      !matchesDateConstraint(fields.date, pendingDateConstraint)
    ) {
      const question = dateConstraintQuestion(pendingDateConstraint!);
      dateConstraintError = `That date doesn't match ${question.slice(6)}. ${question}?`;
    } else if (fields.date !== null) {
      pendingDate = fields.date;
      pendingDateConstraint = null;
    } else {
      pendingDate = pendingDate ?? (due ? dueDate : null);
    }
    pendingTime = fields.time ?? pendingTime ?? (due ? dueTime : null);
    if (pendingDate && pendingTime) {
      try {
        due = fromLocalInput(`${pendingDate}T${pendingTime}`, timeZone);
        pendingDate = null;
        pendingTime = null;
        pendingDateConstraint = null;
      } catch {
        due = "";
      }
    }
  }
  return {
    reminder: {
      ...current,
      title: fields.title ?? current.title,
      person: fields.person ?? current.person,
      notes: fields.notes ?? current.notes,
      due,
      pendingDate,
      pendingTime,
      pendingDateConstraint,
    },
    dateConstraintError,
  };
}

export function spokenReminder(reminder: ActiveReminder, timeZone: string) {
  const when = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(reminder.due));
  return `Okay, I'll remind you to ${reminder.title} on ${when}. Is that correct?`;
}

function nextReply(
  reminder: ActiveReminder,
  timeZone: string,
  dateConstraintError: string | null = null,
) {
  if (dateConstraintError)
    return { stage: "awaiting_details" as const, reply: dateConstraintError };
  if (!reminder.title.trim())
    return {
      stage: "awaiting_details" as const,
      reply: "What would you like me to remind you about?",
    };
  if (!reminder.due && reminder.pendingDateConstraint) {
    const dateQuestion = dateConstraintQuestion(reminder.pendingDateConstraint);
    return {
      stage: "awaiting_details" as const,
      reply: dateConstraintError
        ? `${dateConstraintError} ${dateQuestion}${reminder.pendingTime ? "?" : ", and what time?"}`
        : `${dateQuestion}${reminder.pendingTime ? "?" : ", and what time?"}`,
    };
  }
  if (!reminder.due && reminder.pendingDate)
    return {
      stage: "awaiting_details" as const,
      reply: "Of course! What time should I remind you?",
    };
  if (!reminder.due)
    return {
      stage: "awaiting_details" as const,
      reply: "Sure! When would you like me to remind you?",
    };
  return {
    stage: "reading_back" as const,
    reply: spokenReminder(reminder, timeZone),
  };
}

export function setConversationStage(
  state: ConversationState,
  stage: ConversationStage,
): ConversationState {
  return { ...state, stage };
}

export function finishSpeech(state: ConversationState): ConversationState {
  return state.stage === "reading_back"
    ? { ...state, stage: "awaiting_confirmation" }
    : state;
}

export function advanceConversation(args: {
  state: ConversationState;
  result: IntentResult;
  text: string;
  timeZone: string;
  createId: () => string;
  now?: Date;
}): ConversationTransition {
  const { state, result, text: user, timeZone, createId, now } = args;
  let intent = result.intent;
  if (
    intent.kind === "end_conversation" &&
    (state.stage === "awaiting_confirmation" ||
      state.stage === "reading_back") &&
    /^no\b/i.test(user.trim())
  )
    return withReply(state, user, "No problem. What should I change?", {
      stage: "awaiting_details",
    });
  if (
    (intent.kind === "end_conversation" ||
      isConversationEndingPhrase(user, state.stage)) &&
    state.stage !== "awaiting_confirmation" &&
    state.stage !== "reading_back"
  )
    return withReply(state, user, "Sounds good! Have a great day.", {
      stage: "ended",
      activeReminder: null,
      phase: "ended",
    });
  if (intent.kind === "cancel")
    return withReply(
      state,
      user,
      "Okay, I canceled that unfinished reminder. Anything else?",
      { stage: "canceled", activeReminder: null },
    );
  if (intent.kind === "confirm") {
    if (state.stage === "awaiting_confirmation" && state.activeReminder) {
      const {
        pendingDate: _pendingDate,
        pendingTime: _pendingTime,
        pendingDateConstraint: _pendingDateConstraint,
        ...task
      } = state.activeReminder;
      const savedTask: Task = { ...task, completed: false };
      const reply = "Perfect! Your reminder is saved. Anything else?";
      return {
        state: {
          ...state,
          stage: "saved",
          activeReminder: null,
          lastSavedReminder: state.activeReminder,
          history: withHistory(state, user, reply),
        },
        reply,
        savedTask,
      };
    }
    return withReply(
      state,
      user,
      "I still need the reminder details before I can save it.",
      {},
    );
  }
  if (intent.kind === "reject") {
    if (!state.activeReminder)
      return withReply(
        state,
        user,
        "What would you like me to remind you about?",
        { stage: "idle" },
      );
    return withReply(state, user, "No problem. What should I change?", {
      stage: "awaiting_details",
    });
  }
  const derivedConstraint = deriveDateConstraint(user, timeZone, now);
  if (
    intent.kind === "none" &&
    derivedConstraint &&
    (state.activeReminder ||
      derivedConstraint.month !== null ||
      derivedConstraint.weekday !== null)
  ) {
    intent = {
      kind: "follow_up",
      fields: {
        title: null,
        person: null,
        date: null,
        time: null,
        notes: null,
        clearDue: false,
      },
    };
  }
  if (intent.kind === "none")
    return withReply(
      state,
      user,
      state.activeReminder
        ? "What would you like to change?"
        : "What would you like me to remind you about?",
      { stage: state.activeReminder ? "awaiting_details" : "idle" },
    );

  const activeConstraint = state.activeReminder?.pendingDateConstraint ?? null;
  const deterministicDate = deterministicDateFromText(
    user,
    timeZone,
    activeConstraint ?? derivedConstraint,
    now,
  );
  const fields: IntentFields = {
    ...intent.fields,
    title: isMeaningfulReminderTitle(intent.fields.title)
      ? intent.fields.title
      : null,
    date: derivedConstraint
      ? null
      : (deterministicDate ??
        (mentionsUnambiguousDate(user) ? intent.fields.date : null)),
    time: mentionsExplicitTime(user) ? intent.fields.time : null,
  };
  const applied = applyFields(
    state.activeReminder ?? {
      id: createId(),
      title: "",
      person: "",
      due: "",
      notes: "",
      pendingDate: null,
      pendingTime: null,
      pendingDateConstraint: null,
    },
    fields,
    timeZone,
    derivedConstraint,
  );
  const next = nextReply(
    applied.reminder,
    timeZone,
    applied.dateConstraintError,
  );
  return withReply(state, user, next.reply, {
    stage: next.stage,
    activeReminder: applied.reminder,
  });
}

export function conversationContext(
  state: ConversationState,
): ConversationContext {
  return {
    history: state.history,
    activeReminder: state.activeReminder,
    stage: state.stage,
  };
}
