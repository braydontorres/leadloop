import type { Task } from "./tasks";

export const MAX_HISTORY_TURNS = 6;
export const MAX_KNOWN_TASKS = 12;

export type ConversationTurn = {
  role: "user" | "assistant";
  text: string;
};

export type ContextTask = Pick<
  Task,
  "id" | "title" | "person" | "due" | "notes"
>;

export type TaskDetails = {
  title: string;
  person: string;
  due: string | null;
  notes: string;
};

export type TaskOperation =
  | { type: "create"; task: TaskDetails; targetId?: never }
  | { type: "update"; targetId: string; task: TaskDetails }
  | { type: "cancel"; targetId: string; task?: never }
  | { type: "clarify"; question: string; task?: never; targetId?: never };

export type AssistantResult = {
  message: string;
  operations: TaskOperation[];
};

export type ConversationContext = {
  history: ConversationTurn[];
  knownTasks: ContextTask[];
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

function text(value: unknown, label: string, maxLength = 1000): string {
  if (typeof value !== "string" || !value.trim() || value.length > maxLength) {
    throw new Error(`Invalid ${label}.`);
  }
  return value.trim();
}

function optionalText(value: unknown, label: string, maxLength = 1000): string {
  if (typeof value !== "string" || value.length > maxLength) {
    throw new Error(`Invalid ${label}.`);
  }
  return value.trim();
}

function parseTask(value: unknown): TaskDetails {
  if (!isRecord(value)) throw new Error("Invalid task details.");
  const due = value.due;
  if (
    due !== null &&
    (typeof due !== "string" || Number.isNaN(Date.parse(due)))
  ) {
    throw new Error("Invalid reminder date.");
  }
  return {
    title: text(value.title, "task title", 240),
    person: optionalText(value.person, "person", 160),
    due,
    notes: optionalText(value.notes, "notes", 1000),
  };
}

export function parseAssistantResult(value: unknown): AssistantResult {
  if (!isRecord(value) || !Array.isArray(value.operations)) {
    throw new Error("LeadLoop returned an invalid response.");
  }
  if (value.operations.length > 5) throw new Error("Too many task operations.");
  const operations = value.operations.map((operation): TaskOperation => {
    if (!isRecord(operation) || typeof operation.type !== "string") {
      throw new Error("Invalid task operation.");
    }
    if (operation.type === "create")
      return { type: "create", task: parseTask(operation.task) };
    if (operation.type === "update") {
      return {
        type: "update",
        targetId: text(operation.targetId, "task reference", 120),
        task: parseTask(operation.task),
      };
    }
    if (operation.type === "cancel") {
      return {
        type: "cancel",
        targetId: text(operation.targetId, "task reference", 120),
      };
    }
    if (operation.type === "clarify") {
      return {
        type: "clarify",
        question: text(operation.question, "clarification", 400),
      };
    }
    throw new Error("Unknown task operation.");
  });
  return { message: text(value.message, "assistant message", 500), operations };
}

export function parseConversationContext(value: unknown): ConversationContext {
  if (!isRecord(value)) throw new Error("Invalid conversation context.");
  const history = Array.isArray(value.history)
    ? value.history.slice(-MAX_HISTORY_TURNS).map((turn) => {
        if (
          !isRecord(turn) ||
          (turn.role !== "user" && turn.role !== "assistant")
        )
          throw new Error("Invalid conversation history.");
        return {
          role: turn.role,
          text: text(turn.text, "conversation message", 1200),
        } as ConversationTurn;
      })
    : [];
  const knownTasks = Array.isArray(value.knownTasks)
    ? value.knownTasks.slice(-MAX_KNOWN_TASKS).map((task) => {
        if (!isRecord(task)) throw new Error("Invalid known task.");
        const due = task.due;
        if (typeof due !== "string")
          throw new Error("Invalid known task date.");
        return {
          id: text(task.id, "task id", 120),
          title: text(task.title, "task title", 240),
          person: optionalText(task.person, "person", 160),
          due,
          notes: optionalText(task.notes, "notes", 1000),
        };
      })
    : [];
  return { history, knownTasks };
}

export type ReviewItem = TaskDetails & {
  id: string;
  source: "new" | "existing";
};

export function applyTaskOperations(
  reviewItems: ReviewItem[],
  savedTasks: ContextTask[],
  operations: TaskOperation[],
  newId: () => string,
): { reviewItems: ReviewItem[]; cancelIds: string[]; clarification?: string } {
  const next = [...reviewItems];
  const cancelIds: string[] = [];
  let clarification: string | undefined;
  for (const operation of operations) {
    if (operation.type === "clarify") {
      clarification = operation.question;
      continue;
    }
    if (operation.type === "create") {
      next.push({ id: newId(), source: "new", ...operation.task });
      continue;
    }
    if (operation.type === "cancel") {
      cancelIds.push(operation.targetId);
      continue;
    }
    const reviewIndex = next.findIndex(
      (task) => task.id === operation.targetId,
    );
    if (reviewIndex >= 0) {
      next[reviewIndex] = { ...next[reviewIndex], ...operation.task };
      continue;
    }
    const saved = savedTasks.find((task) => task.id === operation.targetId);
    if (saved) {
      next.push({ id: saved.id, source: "existing", ...operation.task });
      continue;
    }
    throw new Error("LeadLoop could not find the task to update.");
  }
  return {
    reviewItems: next,
    cancelIds: [...new Set(cancelIds)],
    clarification,
  };
}

export function localDateTimeContext(
  timeZone: string,
  now = new Date(),
): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(now);
}
