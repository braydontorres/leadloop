import { fromLocalInput, toLocalInput, type Task } from "./tasks";

export type ConversationPhase =
  | "idle"
  | "awaiting_clarification"
  | "ready_for_review"
  | "confirmed"
  | "canceled";

export type PendingField = "due" | "title" | "task_choice";

export type ConversationDraft = {
  id: string;
  source: "new" | "existing";
  title: string;
  person: string;
  due: string;
  notes: string;
  phase: "awaiting_clarification" | "ready_for_review";
};

export type PendingClarificationState = {
  taskIds: string[];
  field: PendingField;
  question: string;
};

export type ConversationState = {
  phase: ConversationPhase;
  drafts: ConversationDraft[];
  pending: PendingClarificationState[];
  cancellationIds: string[];
  history: Array<{ role: "user" | "assistant"; text: string }>;
  lastTaskId?: string;
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
  kind: "new_task" | "follow_up" | "update" | "cancel" | "clarify" | "none";
  subject: string | null;
  fields: IntentFields;
  clarificationField: PendingField | null;
  question: string | null;
};

export type IntentResult = {
  message: string;
  intent: AssistantIntent;
};

export type ConversationContext = {
  history: ConversationState["history"];
  tasks: Array<Pick<Task, "id" | "title" | "person" | "due" | "notes">>;
  pending: PendingClarificationState[];
  lastTaskId?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function boundedText(value: unknown, label: string, maxLength: number) {
  if (typeof value !== "string" || !value.trim() || value.length > maxLength)
    throw new Error(`Invalid ${label}.`);
  return value.trim();
}

function optionalText(value: unknown, label: string, maxLength: number) {
  if (typeof value !== "string" || value.length > maxLength)
    throw new Error(`Invalid ${label}.`);
  return value.trim();
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
          text: boundedText(turn.text, "conversation message", 1200),
        } as ConversationState["history"][number];
      })
    : [];
  const tasks = Array.isArray(value.tasks)
    ? value.tasks.slice(-12).map((task) => {
        if (!isRecord(task)) throw new Error("Invalid conversation task.");
        return {
          id: boundedText(task.id, "task id", 120),
          title: boundedText(task.title, "task title", 240),
          person: optionalText(task.person, "person", 160),
          due: optionalText(task.due, "task due", 80),
          notes: optionalText(task.notes, "task notes", 1000),
        };
      })
    : [];
  const pending = Array.isArray(value.pending)
    ? value.pending.slice(-3).map((entry) => {
        if (!isRecord(entry) || !Array.isArray(entry.taskIds))
          throw new Error("Invalid pending clarification.");
        if (
          entry.field !== "due" &&
          entry.field !== "title" &&
          entry.field !== "task_choice"
        )
          throw new Error("Invalid pending field.");
        return {
          taskIds: entry.taskIds.map((id) => boundedText(id, "task id", 120)),
          field: entry.field,
          question: boundedText(entry.question, "clarification", 400),
        } as PendingClarificationState;
      })
    : [];
  return {
    history,
    tasks,
    pending,
    lastTaskId:
      value.lastTaskId === undefined
        ? undefined
        : boundedText(value.lastTaskId, "last task id", 120),
  };
}

export function emptyConversationState(): ConversationState {
  return {
    phase: "idle",
    drafts: [],
    pending: [],
    cancellationIds: [],
    history: [],
  };
}

function derivePhase(
  drafts: ConversationDraft[],
  pending: PendingClarificationState[],
  cancellationIds: string[],
): ConversationPhase {
  if (pending.length) return "awaiting_clarification";
  if (cancellationIds.length) return "canceled";
  if (drafts.length) return "ready_for_review";
  return "idle";
}

function normalize(value: string) {
  return value
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function sourceTask(
  id: string,
  drafts: ConversationDraft[],
  savedTasks: Task[],
) {
  const draft = drafts.find((task) => task.id === id);
  if (draft) return draft;
  const saved = savedTasks.find((task) => task.id === id);
  return saved
    ? {
        ...saved,
        source: "existing" as const,
        phase: "ready_for_review" as const,
      }
    : undefined;
}

function targetCandidates(
  state: ConversationState,
  savedTasks: Task[],
  subject: string | null,
  _text: string,
) {
  const all = new Map<string, ConversationDraft>();
  savedTasks.forEach((task) =>
    all.set(task.id, {
      ...task,
      source: "existing",
      phase: "ready_for_review",
    }),
  );
  state.drafts.forEach((task) => all.set(task.id, task));
  // The model supplies a concise subject, but never an ID. Matching the whole
  // normalized subject avoids treating common words such as "call" or
  // "reminder" as a target selector.
  const wanted = normalize(subject ?? "");
  if (!wanted) return [];
  return [...all.values()].filter((task) => {
    const haystack = normalize(`${task.title} ${task.person}`);
    return haystack.includes(wanted);
  });
}

function resolveTarget(
  state: ConversationState,
  savedTasks: Task[],
  intent: AssistantIntent,
  text: string,
) {
  const activePending = state.pending.flatMap((pending) => pending.taskIds);
  const uniquePending = [...new Set(activePending)];
  if (
    (intent.kind === "follow_up" ||
      (intent.kind === "clarify" && intent.clarificationField === "due")) &&
    uniquePending.length === 1
  )
    return { id: uniquePending[0] };
  if (
    (intent.kind === "follow_up" ||
      (intent.kind === "clarify" && intent.clarificationField === "due")) &&
    uniquePending.length > 1
  )
    return { ambiguous: uniquePending };
  const subject = normalize(intent.subject ?? "");
  const lastTask = state.lastTaskId
    ? sourceTask(state.lastTaskId, state.drafts, savedTasks)
    : undefined;
  if (
    subject &&
    lastTask &&
    normalize(`${lastTask.title} ${lastTask.person}`).includes(subject)
  ) {
    return { id: lastTask.id };
  }
  const candidates = targetCandidates(state, savedTasks, intent.subject, text);
  if (candidates.length === 1) return { id: candidates[0].id };
  if (candidates.length > 1)
    return { ambiguous: candidates.map((task) => task.id) };
  if (state.lastTaskId && /\b(it|that|him|her)\b/i.test(text))
    return { id: state.lastTaskId };
  return { ambiguous: [] };
}

function applyFields(
  current: ConversationDraft,
  fields: IntentFields,
  timeZone: string,
) {
  let due = current.due;
  if (fields.clearDue) due = "";
  if (fields.date !== null || fields.time !== null) {
    const previous = due ? toLocalInput(due, timeZone) : "";
    const date = fields.date ?? previous.slice(0, 10);
    const time = fields.time ?? previous.slice(11, 16);
    if (!date || !time) return { draft: current, needsDue: true };
    try {
      due = fromLocalInput(`${date}T${time}`, timeZone);
    } catch {
      return { draft: current, needsDue: true };
    }
  }
  const draft: ConversationDraft = {
    ...current,
    title: fields.title ?? current.title,
    person: fields.person ?? current.person,
    notes: fields.notes ?? current.notes,
    due,
    phase: due ? "ready_for_review" : "awaiting_clarification",
  };
  return { draft, needsDue: !draft.due };
}

function dueClarification(taskId: string): PendingClarificationState {
  return {
    taskIds: [taskId],
    field: "due",
    question: "When would you like to set this reminder?",
  };
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

function stateWith(
  state: ConversationState,
  updates: Partial<ConversationState>,
): ConversationState {
  const next = { ...state, ...updates };
  return {
    ...next,
    phase: derivePhase(next.drafts, next.pending, next.cancellationIds),
  };
}

export function applyAssistantIntent(args: {
  state: ConversationState;
  savedTasks: Task[];
  result: IntentResult;
  text: string;
  timeZone: string;
  createId: () => string;
}): ConversationState {
  const { state, savedTasks, result, text, timeZone, createId } = args;
  const intent = result.intent;
  const message = intent.question ?? result.message;
  const base = (updates: Partial<ConversationState>) =>
    stateWith(state, {
      ...updates,
      history: withHistory(state, text, message),
    });
  if (intent.kind === "none") return base({});
  if (intent.kind === "clarify") {
    const target = resolveTarget(state, savedTasks, intent, text);
    const taskIds = target.id ? [target.id] : (target.ambiguous ?? []);
    const field = intent.clarificationField ?? "task_choice";
    return base({
      pending: [
        ...state.pending.filter(
          (pending) =>
            pending.field !== field ||
            pending.taskIds.join("|") !== taskIds.join("|"),
        ),
        {
          taskIds,
          field,
          question: message,
        },
      ].slice(-3),
    });
  }
  if (intent.kind === "new_task") {
    const id = createId();
    const draft = applyFields(
      {
        id,
        source: "new",
        title: intent.fields.title ?? "",
        person: intent.fields.person ?? "",
        due: "",
        notes: intent.fields.notes ?? "",
        phase: "awaiting_clarification",
      },
      intent.fields,
      timeZone,
    ).draft;
    const pending: PendingClarificationState[] = draft.due
      ? state.pending
      : [...state.pending, dueClarification(id)];
    return base({ drafts: [...state.drafts, draft], pending, lastTaskId: id });
  }
  const target = resolveTarget(state, savedTasks, intent, text);
  if (!target.id) {
    const taskIds = target.ambiguous ?? [];
    return base({
      pending: [
        ...state.pending,
        {
          taskIds,
          field: "task_choice" as PendingField,
          question: "Which reminder would you like to update?",
        },
      ].slice(-3),
    });
  }
  if (intent.kind === "cancel") {
    return base({
      cancellationIds: [...new Set([...state.cancellationIds, target.id])],
      pending: state.pending.filter(
        (pending) => !pending.taskIds.includes(target.id),
      ),
      lastTaskId: target.id,
    });
  }
  const current = sourceTask(target.id, state.drafts, savedTasks);
  if (!current) return base({});
  const applied = applyFields(current, intent.fields, timeZone);
  const drafts = [
    ...state.drafts.filter((draft) => draft.id !== target.id),
    applied.draft,
  ];
  const pending = state.pending.filter(
    (pending) => !pending.taskIds.includes(target.id),
  );
  if (applied.needsDue) pending.push(dueClarification(target.id));
  return base({ drafts, pending: pending.slice(-3), lastTaskId: target.id });
}

export function conversationContext(
  state: ConversationState,
  savedTasks: Task[],
): ConversationContext {
  const tasks = new Map(
    savedTasks.map(({ id, title, person, due, notes }) => [
      id,
      { id, title, person, due, notes },
    ]),
  );
  state.drafts.forEach(({ id, title, person, due, notes }) =>
    tasks.set(id, { id, title, person, due, notes }),
  );
  return {
    history: state.history,
    tasks: [...tasks.values()].slice(-12),
    pending: state.pending,
    lastTaskId: state.lastTaskId,
  };
}
