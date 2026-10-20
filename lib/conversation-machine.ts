import { type Task } from "./tasks";
import {
  calendarFromLegacy,
  calendarInvalidMessage,
  calendarProjection,
  calendarLanguageFieldsFromText,
  createCalendarExpression,
  dateWithImplicitYear,
  hasSchedulingCorrectionLanguage,
  implicitMonthDayFromText,
  mergeCalendarExpression,
  parseCalendarExpression,
  resolveCalendarExpression,
  type CalendarExpression,
  type RelativeDateExpression,
} from "./calendar-expression";
import {
  cleanReminderTitle,
  dateConstraintQuestion,
  deriveDateConstraint,
  deterministicDateFromText,
  matchesDateConstraint,
  mentionsUnambiguousDate,
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
  /** Canonical scheduling state. The pending* fields below are a read-only compatibility projection. */
  calendar: CalendarExpression;
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
  const common = {
    id: text(value.id, "reminder id", 120),
    title: text(value.title, "reminder title", 240, true),
    person: text(value.person, "person", 160, true),
    due: text(value.due, "reminder time", 80, true),
    notes: text(value.notes, "notes", 1000, true),
  };
  const calendar =
    value.calendar === undefined
      ? calendarFromLegacy({
          timeZone: "UTC",
          due: common.due,
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
        })
      : parseCalendarExpression(value.calendar);
  return reminderWithCalendar({ ...common, calendar });
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

/** Keeps older UI/API fields available while making CalendarExpression the only mutable schedule state. */
function reminderWithCalendar(
  reminder: Pick<ActiveReminder, "id" | "title" | "person" | "notes"> & {
    calendar: CalendarExpression;
  },
): ActiveReminder {
  const projection = calendarProjection(reminder.calendar);
  return { ...reminder, ...projection };
}

function applyFields(
  current: ActiveReminder,
  fields: IntentFields,
  timeZone: string,
  dateConstraint: DateConstraint | null,
  relativeDate: RelativeDateExpression | null,
  implicitYearForDate: boolean,
  replacesDateConstraint: boolean,
) {
  let calendar = current.calendar;
  let dateConstraintError: string | null = null;
  if (dateConstraint) {
    calendar = mergeCalendarExpression(calendar, {
      constraint: dateConstraint,
    });
  }
  if (fields.clearDue)
    calendar = mergeCalendarExpression(calendar, { clear: true });
  if (relativeDate)
    calendar = mergeCalendarExpression(calendar, { relative: relativeDate });
  if (replacesDateConstraint && !relativeDate)
    calendar = mergeCalendarExpression(calendar, { constraint: null });
  if (fields.date !== null || fields.time !== null) {
    if (
      fields.date !== null &&
      !matchesDateConstraint(fields.date, calendar.date.constraint)
    ) {
      const question = dateConstraintQuestion(calendar.date.constraint!);
      dateConstraintError = `That date doesn't match ${question.slice(6)}. ${question}?`;
    } else
      calendar = mergeCalendarExpression(calendar, {
        date: fields.date === null ? undefined : fields.date,
        implicitYear: fields.date === null ? undefined : implicitYearForDate,
        time: fields.time === null ? undefined : fields.time,
      });
  }
  const resolution = resolveCalendarExpression(calendar);
  dateConstraintError =
    dateConstraintError ?? calendarInvalidMessage(resolution);
  return {
    reminder: reminderWithCalendar({
      id: current.id,
      title: fields.title ?? current.title,
      person: fields.person ?? current.person,
      notes: fields.notes ?? current.notes,
      calendar,
    }),
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
  const calendar = resolveCalendarExpression(reminder.calendar);
  if (calendar.kind === "ambiguous" && reminder.calendar.date.constraint) {
    const dateQuestion = dateConstraintQuestion(
      reminder.calendar.date.constraint,
    );
    const needsTime = !reminder.calendar.time.local;
    return {
      stage: "awaiting_details" as const,
      reply: dateConstraintError
        ? `${dateConstraintError} ${dateQuestion}?`
        : `${dateQuestion}${needsTime ? ", and what time?" : "?"}`,
    };
  }
  if (calendar.kind === "ambiguous")
    return {
      stage: "awaiting_details" as const,
      reply:
        calendar.ambiguities[0]?.reason ===
        "a reminder date is needed before using later"
          ? "What date should I count from before moving it later?"
          : "Which date should I use?",
    };
  if (
    calendar.kind === "incomplete" &&
    calendar.missing.includes("time") &&
    !calendar.missing.includes("date")
  )
    return {
      stage: "awaiting_details" as const,
      reply: "Of course! What time should I remind you?",
    };
  if (calendar.kind !== "resolved")
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
  const initialCalendar =
    state.activeReminder?.calendar ?? createCalendarExpression(timeZone, now);
  const language = calendarLanguageFieldsFromText(user, initialCalendar);
  // A fully resolved relative/weekday expression must not also become a
  // partial weekday constraint. That would make an unambiguous "next Friday"
  // ask a second question about its month.
  const derivedConstraint =
    language.date || language.relative
      ? null
      : deriveDateConstraint(user, timeZone, now);
  const relativeDate = language.relative;
  // A month/day without a year gets the implicit-year treatment only when it
  // does not contradict an already established explicit calendar year. An
  // active `July 2027 / Saturday` constraint, for example, deliberately
  // remains the source of the year for a reply such as "July 10 at 3 PM".
  // This lets the deterministic constraint validation complete the reminder
  // instead of replacing the established context with a fresh implicit date.
  const implicitMonthDay =
    initialCalendar.date.constraint?.year === null ||
    initialCalendar.date.constraint === null
      ? implicitMonthDayFromText(user)
      : null;
  const implicitMonthDate = implicitMonthDay
    ? dateWithImplicitYear(implicitMonthDay, initialCalendar)
    : null;
  const activeCalendarClarification =
    state.activeReminder?.calendar.date.constraint ?? null;
  const activeConstraint =
    state.activeReminder?.calendar.date.constraint ?? null;
  const deterministicDate =
    language.date ??
    (relativeDate
      ? null
      : deterministicDateFromText(
          user,
          timeZone,
          activeConstraint ?? derivedConstraint,
          now,
        ));
  const deterministicTime = language.time;
  const hasDeterministicScheduleChange = Boolean(
    derivedConstraint ||
    relativeDate ||
    deterministicDate ||
    deterministicTime ||
    language.hasAmbiguousTime,
  );

  // An ordinal reply answers the application's outstanding calendar question.
  // Treat it as a follow-up before consulting the model's intent label: models
  // may label a short phrase such as "the fifth Saturday" as none, confirm, or
  // even a new task, but none of those labels should discard the active draft.
  if (
    activeCalendarClarification &&
    derivedConstraint &&
    derivedConstraint.occurrence !== null
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
  // A clear scheduling correction must win over a model label such as confirm
  // or none. Otherwise an old read-back could be saved after the user asked to
  // change its date or time.
  if (
    state.activeReminder &&
    hasDeterministicScheduleChange &&
    (state.stage === "reading_back" ||
      state.stage === "awaiting_confirmation" ||
      intent.kind === "update" ||
      intent.kind === "none")
  ) {
    intent = {
      kind: "update",
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
  if (
    state.activeReminder &&
    (state.stage === "reading_back" ||
      state.stage === "awaiting_confirmation") &&
    hasSchedulingCorrectionLanguage(user) &&
    !hasDeterministicScheduleChange
  )
    return withReply(
      state,
      user,
      "I couldn't reliably understand that scheduling change. What date or time should I use instead?",
      { stage: "awaiting_details" },
    );
  if (intent.kind === "confirm") {
    if (state.stage === "awaiting_confirmation" && state.activeReminder) {
      const {
        calendar: _calendar,
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
  if (
    intent.kind === "none" &&
    state.activeReminder &&
    language.hasAmbiguousTime
  )
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
  if (intent.kind === "none")
    return withReply(
      state,
      user,
      state.activeReminder
        ? "What would you like to change?"
        : "What would you like me to remind you about?",
      { stage: state.activeReminder ? "awaiting_details" : "idle" },
    );

  const fields: IntentFields = {
    ...intent.fields,
    title: cleanReminderTitle(intent.fields.title),
    date:
      derivedConstraint || relativeDate
        ? null
        : (implicitMonthDate ??
          deterministicDate ??
          (mentionsUnambiguousDate(user) ? intent.fields.date : null)),
    time: deterministicTime,
  };
  const applied = applyFields(
    state.activeReminder ??
      reminderWithCalendar({
        id: createId(),
        title: "",
        person: "",
        notes: "",
        calendar: initialCalendar,
      }),
    fields,
    timeZone,
    derivedConstraint,
    relativeDate,
    implicitMonthDate !== null,
    language.replacesDateConstraint,
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
