import type { Task } from "./tasks";

export const MAX_HISTORY_TURNS = 6;
export const MAX_KNOWN_TASKS = 12;
export const MAX_PENDING_CLARIFICATIONS = 3;
export const AVAILABLE_DRAFT_IDS_PER_TURN = 5;

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

export type TaskChanges = Partial<TaskDetails>;

export type TaskOperation =
  | { type: "create"; targetId: string; task: TaskDetails }
  | { type: "update"; targetId: string; changes: TaskChanges }
  | { type: "cancel"; targetId: string; task?: never }
  | {
      type: "clarify";
      question: string;
      targetIds: string[];
      task?: never;
      targetId?: never;
    };

export type AssistantResult = {
  message: string;
  operations: TaskOperation[];
};

export type ConversationContext = {
  history: ConversationTurn[];
  knownTasks: ContextTask[];
  pendingClarifications: PendingClarification[];
  availableDraftIds: string[];
};

export type PendingClarification = {
  question: string;
  taskIds: string[];
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
  if (due !== null && typeof due !== "string") {
    throw new Error("Invalid reminder date.");
  }
  return {
    title: text(value.title, "task title", 240),
    person: optionalText(value.person, "person", 160),
    due: due === null ? null : normalizeIsoInstant(due),
    notes: optionalText(value.notes, "notes", 1000),
  };
}

function normalizeIsoInstant(value: string) {
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(
      value,
    )
  ) {
    throw new Error("Invalid reminder date.");
  }
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) throw new Error("Invalid reminder date.");
  return new Date(timestamp).toISOString();
}

function parseChanges(value: unknown): TaskChanges {
  if (!isRecord(value)) throw new Error("Invalid task changes.");
  if (typeof value.clearDue !== "boolean") {
    throw new Error("Invalid reminder update.");
  }
  const changes: TaskChanges = {};
  if (value.title !== null)
    changes.title = text(value.title, "task title", 240);
  if (value.person !== null)
    changes.person = optionalText(value.person, "person", 160);
  if (value.notes !== null)
    changes.notes = optionalText(value.notes, "notes", 1000);
  if (value.due !== null) {
    if (typeof value.due !== "string") {
      throw new Error("Invalid reminder date.");
    }
    changes.due = normalizeIsoInstant(value.due);
  }
  if (value.clearDue) {
    if (value.due !== null) throw new Error("Invalid reminder update.");
    changes.due = null;
  }
  if (Object.keys(changes).length === 0) {
    throw new Error("An update must change at least one task field.");
  }
  return changes;
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
      return {
        type: "create",
        targetId: text(operation.targetId, "new task reference", 120),
        task: parseTask(operation.task),
      };
    if (operation.type === "update") {
      return {
        type: "update",
        targetId: text(operation.targetId, "task reference", 120),
        changes: parseChanges(operation.changes),
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
        targetIds: Array.isArray(operation.targetIds)
          ? operation.targetIds.map((id) => text(id, "task reference", 120))
          : (() => {
              throw new Error("Invalid clarification targets.");
            })(),
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
  const pendingClarifications = Array.isArray(value.pendingClarifications)
    ? value.pendingClarifications
        .slice(-MAX_PENDING_CLARIFICATIONS)
        .map((clarification) => {
          if (
            !isRecord(clarification) ||
            !Array.isArray(clarification.taskIds)
          ) {
            throw new Error("Invalid pending clarification.");
          }
          return {
            question: text(clarification.question, "clarification", 400),
            taskIds: clarification.taskIds.map((id) =>
              text(id, "task reference", 120),
            ),
          };
        })
    : [];
  const availableDraftIds = Array.isArray(value.availableDraftIds)
    ? value.availableDraftIds
        .slice(0, AVAILABLE_DRAFT_IDS_PER_TURN)
        .map((id) => text(id, "available draft reference", 120))
    : [];
  return { history, knownTasks, pendingClarifications, availableDraftIds };
}

export type ReviewItem = TaskDetails & {
  id: string;
  source: "new" | "existing";
};

export type AppliedTaskOperations = {
  reviewItems: ReviewItem[];
  cancelIds: string[];
  clarification?: PendingClarification;
  touchedIds: string[];
};

export function applyTaskOperations(
  reviewItems: ReviewItem[],
  savedTasks: ContextTask[],
  operations: TaskOperation[],
): AppliedTaskOperations {
  const next = [...reviewItems];
  const cancelIds: string[] = [];
  const touchedIds: string[] = [];
  let clarification: PendingClarification | undefined;
  for (const operation of operations) {
    if (operation.type === "clarify") {
      clarification = {
        question: operation.question,
        taskIds: operation.targetIds,
      };
      continue;
    }
    if (operation.type === "create") {
      if (next.some((task) => task.id === operation.targetId)) {
        throw new Error("LeadLoop returned a duplicate draft reference.");
      }
      next.push({ id: operation.targetId, source: "new", ...operation.task });
      continue;
    }
    if (operation.type === "cancel") {
      cancelIds.push(operation.targetId);
      touchedIds.push(operation.targetId);
      continue;
    }
    const reviewIndex = next.findIndex(
      (task) => task.id === operation.targetId,
    );
    if (reviewIndex >= 0) {
      next[reviewIndex] = { ...next[reviewIndex], ...operation.changes };
      touchedIds.push(operation.targetId);
      continue;
    }
    const saved = savedTasks.find((task) => task.id === operation.targetId);
    if (saved) {
      next.push({ ...saved, source: "existing", ...operation.changes });
      touchedIds.push(operation.targetId);
      continue;
    }
    throw new Error("LeadLoop could not find the task to update.");
  }
  return {
    reviewItems: next,
    cancelIds: [...new Set(cancelIds)],
    clarification,
    touchedIds: [...new Set(touchedIds)],
  };
}

export function advancePendingClarifications(
  current: PendingClarification[],
  applied: AppliedTaskOperations,
) {
  let next = current.filter(
    (clarification) =>
      !clarification.taskIds.some((id) => applied.touchedIds.includes(id)),
  );
  if (applied.clarification) {
    next = next.filter(
      (clarification) =>
        !clarification.taskIds.some((id) =>
          applied.clarification?.taskIds.includes(id),
        ),
    );
    next.push(applied.clarification);
  }
  return next.slice(-MAX_PENDING_CLARIFICATIONS);
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
