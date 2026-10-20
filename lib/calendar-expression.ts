import { fromLocalInput } from "./tasks";
import {
  calendarDateForWeekdayOccurrence,
  matchesDateConstraint,
  resolveDateConstraint,
  type DateConstraint,
  type WeekdayOccurrence,
} from "./reminder-details";

/**
 * The canonical scheduling state for one reminder.  It intentionally keeps
 * partial constraints (for example, "a Saturday next July") instead of
 * turning them into a guessed timestamp.
 */
export type CalendarExpression = {
  version: 1;
  timeZone: string;
  /** Captured once when the draft is created so later relative parsing cannot drift. */
  referenceInstant: string;
  date: {
    /** An explicit YYYY-MM-DD supplied by the user. */
    absolute: string | null;
    /** A partially specified or ordinal weekday date. */
    constraint: DateConstraint | null;
    /** Reserved representation for Phase C relative language. */
    relative: RelativeDateExpression | null;
    /** Reserved representation for Phase C ranges. */
    range: DateRangeExpression | null;
  };
  time: { local: string | null };
  /** Reserved for Phase C durations and offsets. */
  offset: RelativeOffset | null;
  /** Reserved for Phase C repeating reminders. */
  recurrence: RecurrenceExpression | null;
  /** Reserved for Phase C recurrence exceptions. */
  exceptions: string[];
  ambiguities: CalendarAmbiguity[];
  correctionTargets: CalendarField[];
};

export type CalendarField = "date" | "time" | "timezone" | "weekday_occurrence";
export type CalendarAmbiguity = {
  field: CalendarField;
  reason: string;
};
export type RelativeDateExpression = {
  kind: "keyword" | "offset";
  value: string;
};
export type RelativeOffset = {
  amount: number;
  unit: "minutes" | "hours" | "days" | "weeks" | "months" | "years";
  direction: "before" | "after";
};
export type DateRangeExpression = { start: string | null; end: string | null };
export type RecurrenceExpression = {
  frequency: "daily" | "weekly" | "monthly" | "yearly" | "custom";
  interval: number;
};

export type CalendarResolution =
  | { kind: "resolved"; date: string; time: string; instant: string }
  | { kind: "incomplete"; missing: CalendarField[]; date: string | null }
  | { kind: "ambiguous"; ambiguities: CalendarAmbiguity[] }
  | {
      kind: "invalid";
      reason:
        | "invalid_date"
        | "constraint_conflict"
        | "unavailable_occurrence"
        | "invalid_local_time";
      occurrenceCount?: number;
      constraint?: DateConstraint;
    }
  | { kind: "unsupported"; features: string[] };

export type CalendarExpressionUpdate = {
  date?: string | null;
  time?: string | null;
  constraint?: DateConstraint | null;
  clear?: boolean;
  correctionTargets?: CalendarField[];
};

export type CalendarProjection = {
  due: string;
  pendingDate: string | null;
  pendingTime: string | null;
  pendingDateConstraint: DateConstraint | null;
};

function dateIsValid(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const [year, month, day] = match.slice(1).map(Number);
  const candidate = new Date(Date.UTC(year, month - 1, day));
  return (
    candidate.getUTCFullYear() === year &&
    candidate.getUTCMonth() + 1 === month &&
    candidate.getUTCDate() === day
  );
}

function timeIsValid(value: string) {
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
}

export function createCalendarExpression(
  timeZone: string,
  now = new Date(),
): CalendarExpression {
  return {
    version: 1,
    timeZone,
    referenceInstant: now.toISOString(),
    date: { absolute: null, constraint: null, relative: null, range: null },
    time: { local: null },
    offset: null,
    recurrence: null,
    exceptions: [],
    ambiguities: [],
    correctionTargets: [],
  };
}

function localDueParts(due: string, timeZone: string) {
  if (!due || Number.isNaN(Date.parse(due))) return { date: null, time: null };
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(due));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((entry) => entry.type === type)?.value ?? "";
  return {
    date: `${part("year")}-${part("month")}-${part("day")}`,
    time: `${part("hour")}:${part("minute")}`,
  };
}

/** Adapter for saved/older conversation state. CalendarExpression is canonical after this call. */
export function calendarFromLegacy(args: {
  timeZone: string;
  due?: string | null;
  pendingDate?: string | null;
  pendingTime?: string | null;
  pendingDateConstraint?: DateConstraint | null;
  now?: Date;
}): CalendarExpression {
  const expression = createCalendarExpression(args.timeZone, args.now);
  const due = localDueParts(args.due ?? "", args.timeZone);
  expression.date.absolute = args.pendingDate ?? due.date;
  expression.time.local = args.pendingTime ?? due.time;
  expression.date.constraint = args.pendingDateConstraint ?? null;
  return expression;
}

export function mergeCalendarExpression(
  current: CalendarExpression,
  update: CalendarExpressionUpdate,
): CalendarExpression {
  const base = update.clear
    ? createCalendarExpression(
        current.timeZone,
        new Date(current.referenceInstant),
      )
    : current;
  const constraint =
    update.constraint === undefined
      ? base.date.constraint
      : update.constraint === null
        ? null
        : mergeConstraints(base.date.constraint, update.constraint);
  const replacesDateThroughConstraint =
    update.constraint !== undefined && update.constraint !== null;
  return {
    ...base,
    date: {
      ...base.date,
      // A new ordinal/weekday constraint is a correction to the prior exact date.
      absolute: replacesDateThroughConstraint
        ? null
        : update.date === undefined
          ? base.date.absolute
          : update.date,
      constraint,
    },
    time: {
      local: update.time === undefined ? base.time.local : update.time,
    },
    correctionTargets: update.correctionTargets ?? base.correctionTargets,
  };
}

export function mergeConstraints(
  current: DateConstraint | null,
  update: DateConstraint,
): DateConstraint {
  return {
    year: update.year ?? current?.year ?? null,
    month: update.month ?? current?.month ?? null,
    weekday: update.weekday ?? current?.weekday ?? null,
    occurrence: update.occurrence ?? current?.occurrence ?? null,
  };
}

function unsupportedFeatures(expression: CalendarExpression) {
  const features: string[] = [];
  if (expression.date.relative) features.push("relative dates");
  if (expression.date.range) features.push("date ranges");
  if (expression.offset) features.push("relative offsets");
  if (expression.recurrence) features.push("recurrence");
  if (expression.exceptions.length) features.push("exceptions");
  return features;
}

function constraintMissing(constraint: DateConstraint): CalendarField[] {
  const missing: CalendarField[] = [];
  if (
    constraint.year === null ||
    constraint.month === null ||
    constraint.weekday === null
  )
    missing.push("date");
  else if (constraint.occurrence === null) missing.push("weekday_occurrence");
  return missing;
}

/** Deterministically resolve only the Phase B one-time date/time subset. */
export function resolveCalendarExpression(
  expression: CalendarExpression,
): CalendarResolution {
  const unsupported = unsupportedFeatures(expression);
  if (unsupported.length) return { kind: "unsupported", features: unsupported };
  if (expression.date.absolute && !dateIsValid(expression.date.absolute))
    return { kind: "invalid", reason: "invalid_date" };
  if (expression.time.local && !timeIsValid(expression.time.local))
    return { kind: "invalid", reason: "invalid_local_time" };

  let date = expression.date.absolute;
  const constraint = expression.date.constraint;
  if (constraint) {
    if (date && !matchesDateConstraint(date, constraint))
      return { kind: "invalid", reason: "constraint_conflict", constraint };
    if (!date) {
      const resolution = resolveDateConstraint(constraint);
      if (resolution.status === "incomplete")
        return {
          kind: "ambiguous",
          ambiguities: constraintMissing(constraint).map((field) => ({
            field,
            reason:
              field === "weekday_occurrence"
                ? "weekday occurrence"
                : "partial date",
          })),
        };
      if (resolution.status === "unavailable")
        return {
          kind: "invalid",
          reason: "unavailable_occurrence",
          occurrenceCount: resolution.occurrenceCount,
          constraint,
        };
      date = resolution.date;
    }
  }
  const missing: CalendarField[] = [];
  if (!date) missing.push("date");
  if (!expression.time.local) missing.push("time");
  if (missing.length) return { kind: "incomplete", missing, date };
  const resolvedDate = date as string;
  const resolvedTime = expression.time.local as string;
  try {
    return {
      kind: "resolved",
      date: resolvedDate,
      time: resolvedTime,
      instant: fromLocalInput(
        `${resolvedDate}T${resolvedTime}`,
        expression.timeZone,
      ),
    };
  } catch {
    return { kind: "invalid", reason: "invalid_local_time" };
  }
}

/** Compatibility view for existing UI and server context. Do not mutate it. */
export function calendarProjection(
  expression: CalendarExpression,
): CalendarProjection {
  const resolution = resolveCalendarExpression(expression);
  if (resolution.kind === "resolved")
    return {
      due: resolution.instant,
      pendingDate: null,
      pendingTime: null,
      pendingDateConstraint: null,
    };
  if (resolution.kind === "incomplete")
    return {
      due: "",
      pendingDate: resolution.date,
      pendingTime: expression.time.local,
      // Once a constraint deterministically produces a calendar day, expose
      // that day to legacy consumers. The constraint remains canonical state
      // for later corrections such as "make it the fourth one".
      pendingDateConstraint: resolution.date
        ? null
        : expression.date.constraint,
    };
  return {
    due: "",
    pendingDate: null,
    pendingTime: expression.time.local,
    pendingDateConstraint: expression.date.constraint,
  };
}

export function calendarInvalidMessage(resolution: CalendarResolution) {
  if (resolution.kind !== "invalid") return null;
  if (resolution.reason !== "unavailable_occurrence" || !resolution.constraint)
    return resolution.reason === "constraint_conflict"
      ? "That date doesn't match the date details already provided. What date should I use?"
      : "That date or time is not valid in your selected time zone. What should I use instead?";
  const weekday = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(2023, 0, 1 + resolution.constraint.weekday!)));
  const count = resolution.occurrenceCount ?? 0;
  const countWord =
    ["zero", "one", "two", "three", "four", "five"][count] ?? String(count);
  const ordinal =
    ["zeroth", "first", "second", "third", "fourth", "fifth"][count] ??
    `${count}th`;
  return `That month only has ${countWord} ${weekday}s. Would you like the ${ordinal} ${weekday} instead?`;
}

export function weekdayOccurrence(value: CalendarExpression) {
  return value.date.constraint?.occurrence ?? null;
}

/** Validates serialized client context before it is used by the API route. */
export function parseCalendarExpression(value: unknown): CalendarExpression {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid calendar expression.");
  const source = value as Record<string, unknown>;
  if (
    source.version !== 1 ||
    typeof source.timeZone !== "string" ||
    typeof source.referenceInstant !== "string"
  )
    throw new Error("Invalid calendar expression.");
  const date = source.date;
  const time = source.time;
  if (
    !date ||
    typeof date !== "object" ||
    Array.isArray(date) ||
    !time ||
    typeof time !== "object" ||
    Array.isArray(time)
  )
    throw new Error("Invalid calendar expression.");
  const parsedDate = date as Record<string, unknown>;
  const parsedTime = time as Record<string, unknown>;
  const nullableString = (item: unknown) =>
    item === null || typeof item === "string";
  if (!nullableString(parsedDate.absolute) || !nullableString(parsedTime.local))
    throw new Error("Invalid calendar expression.");
  const constraint = parsedDate.constraint;
  const validConstraint =
    constraint === null ||
    (typeof constraint === "object" &&
      !Array.isArray(constraint) &&
      (() => {
        const c = constraint as Record<string, unknown>;
        const validPart = (part: unknown, min: number, max: number) =>
          part === null ||
          (Number.isInteger(part) &&
            (part as number) >= min &&
            (part as number) <= max);
        return (
          validPart(c.year, 2000, 9999) &&
          validPart(c.month, 1, 12) &&
          validPart(c.weekday, 0, 6) &&
          (c.occurrence === null ||
            c.occurrence === 1 ||
            c.occurrence === 2 ||
            c.occurrence === 3 ||
            c.occurrence === 4 ||
            c.occurrence === 5 ||
            c.occurrence === "last" ||
            c.occurrence === "second_to_last")
        );
      })());
  if (!validConstraint) throw new Error("Invalid calendar expression.");
  // Phase B only serializes the one-time subset. Reject arbitrary new shapes.
  if (
    parsedDate.relative !== null ||
    parsedDate.range !== null ||
    source.offset !== null ||
    source.recurrence !== null ||
    !Array.isArray(source.exceptions) ||
    !Array.isArray(source.ambiguities) ||
    !Array.isArray(source.correctionTargets)
  )
    throw new Error("Invalid calendar expression.");
  return value as CalendarExpression;
}

export type { DateConstraint, WeekdayOccurrence };
