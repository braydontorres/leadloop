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
    /** True only when the user supplied a month/day without a year. */
    implicitYear: boolean;
    /** A partially specified or ordinal weekday date. */
    constraint: DateConstraint | null;
    /** The limited, deterministic relative-date subset supported by this repair. */
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
  kind: "calendar_offset";
  amount: number;
  unit: "days" | "weeks" | "months" | "years";
  /** `later` is anchored to the existing reminder date; the other forms use the draft reference day. */
  anchor: "reference_day" | "existing_reminder_date";
};
export type CalendarLanguageFields = {
  /** A fully deterministic local calendar date extracted from the turn. */
  date: string | null;
  /** A safe local clock time. `null` keeps an AM/PM-ambiguous clock unanswered. */
  time: string | null;
  relative: RelativeDateExpression | null;
  /** A relative correction deliberately replaces an older ordinal constraint. */
  replacesDateConstraint: boolean;
  hasAmbiguousTime: boolean;
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
        | "invalid_local_time"
        | "past_date";
      occurrenceCount?: number;
      constraint?: DateConstraint;
    }
  | { kind: "unsupported"; features: string[] };

export type CalendarExpressionUpdate = {
  date?: string | null;
  implicitYear?: boolean;
  time?: string | null;
  constraint?: DateConstraint | null;
  relative?: RelativeDateExpression | null;
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

function localDateParts(instant: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((entry) => entry.type === type)?.value ?? 0);
  return { year: part("year"), month: part("month"), day: part("day") };
}

function isoDate({
  year,
  month,
  day,
}: {
  year: number;
  month: number;
  day: number;
}) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function parseIsoDate(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match || !dateIsValid(value)) return null;
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
}

/**
 * Adds calendar days, weeks, or months in local-date space. Month arithmetic
 * clamps an overflowing day to the final day of the target month (Jan 31 + one
 * month becomes Feb 28/29), avoiding JavaScript's accidental March rollover.
 */
function addRelativeDate(
  base: { year: number; month: number; day: number },
  relative: RelativeDateExpression,
) {
  if (relative.unit === "years") {
    const year = base.year + relative.amount;
    const lastDay = new Date(Date.UTC(year, base.month, 0)).getUTCDate();
    return isoDate({
      year,
      month: base.month,
      day: Math.min(base.day, lastDay),
    });
  }
  if (relative.unit === "months") {
    const monthIndex = base.month - 1 + relative.amount;
    const year = base.year + Math.floor(monthIndex / 12);
    const month = (((monthIndex % 12) + 12) % 12) + 1;
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    return isoDate({ year, month, day: Math.min(base.day, lastDay) });
  }
  const offset = relative.amount * (relative.unit === "weeks" ? 7 : 1);
  const date = new Date(Date.UTC(base.year, base.month - 1, base.day + offset));
  return isoDate({
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  });
}

const numberWords: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  ninety: 90,
};

const weekdayNames = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

const monthNames = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

/** A concrete month/day that deliberately omitted its year. */
export function implicitMonthDayFromText(text: string) {
  const match = text.match(
    new RegExp(
      `\\b(${monthNames.join("|")})\\s+(\\d{1,2})(?!\\s*,?\\s*20\\d{2})\\b`,
      "i",
    ),
  );
  if (!match) return null;
  const month = monthNames.indexOf(match[1].toLowerCase()) + 1;
  const day = Number(match[2]);
  const probe = new Date(Date.UTC(2026, month - 1, day));
  if (probe.getUTCMonth() + 1 !== month || probe.getUTCDate() !== day)
    return null;
  return { month, day };
}

export function dateWithImplicitYear(
  monthDay: { month: number; day: number },
  expression: CalendarExpression,
) {
  const reference = referenceDate(expression);
  const value = isoDate({ year: reference.year, ...monthDay });
  return dateIsValid(value) ? value : null;
}

/**
 * Parses only the explicitly supported relative-date phrases. It is central so
 * typed and voice turns cannot diverge. `null` means this phrase is not part of
 * the supported subset and must be clarified instead of guessed.
 */
export function relativeDateExpressionFromText(
  text: string,
): RelativeDateExpression | null {
  if (/\bday after tomorrow\b/i.test(text))
    return {
      kind: "calendar_offset",
      amount: 2,
      unit: "days",
      anchor: "reference_day",
    };
  if (/\btomorrow\b/i.test(text))
    return {
      kind: "calendar_offset",
      amount: 1,
      unit: "days",
      anchor: "reference_day",
    };
  const match = text.match(
    /\b(?:(a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)|(\d+))\s+(day|days|week|weeks|month|months|year|years)\s+(?:from\s+(?:today|now)|later|(?:after|before)\s+(?:that|it|the\s+(?:reminder|date)))\b|\bin\s+(?:(a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)|(\d+))\s+(day|days|week|weeks|month|months|year|years)\b/i,
  );
  if (!match) return null;
  const amount =
    Number(match[1] ?? match[2] ?? match[4] ?? match[5]) ||
    numberWords[(match[1] ?? match[4] ?? "").toLowerCase()] ||
    0;
  const unitText = (match[3] ?? match[6] ?? "").toLowerCase();
  if (!amount || amount > 99) return null;
  const unit = unitText.startsWith("day")
    ? "days"
    : unitText.startsWith("week")
      ? "weeks"
      : unitText.startsWith("month")
        ? "months"
        : unitText.startsWith("year")
          ? "years"
          : null;
  if (!unit) return null;
  return {
    kind: "calendar_offset",
    amount: /\bbefore\b/i.test(match[0]) ? -amount : amount,
    unit,
    anchor: /\b(?:later|after|before)\b/i.test(match[0])
      ? "existing_reminder_date"
      : "reference_day",
  };
}

function numberFromText(value: string | undefined) {
  if (!value) return 0;
  return Number(value) || numberWords[value.toLowerCase()] || 0;
}

function localDateTimeParts(instant: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((entry) => entry.type === type)?.value ?? 0);
  return {
    year: part("year"),
    month: part("month"),
    day: part("day"),
    hour: part("hour"),
    minute: part("minute"),
  };
}

function relativeFromDays(amount: number): RelativeDateExpression {
  return {
    kind: "calendar_offset",
    amount,
    unit: "days",
    anchor: "reference_day",
  };
}

function weekdayFromReference(
  expression: CalendarExpression,
  weekday: number,
  mode: "this" | "next" | "after_next",
) {
  const reference = referenceDate(expression);
  const current = new Date(
    Date.UTC(reference.year, reference.month - 1, reference.day),
  );
  const initial = (weekday - current.getUTCDay() + 7) % 7;
  const offset =
    mode === "this"
      ? initial
      : mode === "next"
        ? initial || 7
        : (initial || 7) + 7;
  current.setUTCDate(current.getUTCDate() + offset);
  return isoDate({
    year: current.getUTCFullYear(),
    month: current.getUTCMonth() + 1,
    day: current.getUTCDate(),
  });
}

function explicitDateFromText(text: string, expression: CalendarExpression) {
  const isoMatch = text.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  if (isoMatch && dateIsValid(isoMatch[1])) return isoMatch[1];
  const match = text.match(
    new RegExp(
      `\\b(${monthNames.join("|")})\\s+(\\d{1,2})(?:,?\\s*(20\\d{2}))?\\b`,
      "i",
    ),
  );
  if (!match) return null;
  const month = monthNames.indexOf(match[1].toLowerCase()) + 1;
  const day = Number(match[2]);
  if (match[3]) {
    const value = isoDate({ year: Number(match[3]), month, day });
    return dateIsValid(value) ? value : null;
  }
  if (
    expression.date.constraint?.year !== null &&
    expression.date.constraint?.year !== undefined
  ) {
    const value = isoDate({
      year: expression.date.constraint.year,
      month,
      day,
    });
    return dateIsValid(value) ? value : null;
  }
  return dateWithImplicitYear({ month, day }, expression);
}

function addToDate(
  date: string,
  amount: number,
  unit: RelativeDateExpression["unit"],
) {
  const parsed = parseIsoDate(date);
  if (!parsed) return null;
  return addRelativeDate(parsed, {
    kind: "calendar_offset",
    amount,
    unit,
    anchor: "reference_day",
  });
}

export function naturalTimeFromText(text: string) {
  const toHour = (value: string) => numberFromText(value) || Number(value);
  const normalized = (
    hour: number,
    minute: number,
    marker: string | undefined,
  ) => {
    if (!marker || hour < 1 || hour > 12 || minute < 0 || minute > 59)
      return null;
    const converted =
      marker.toLowerCase() === "p"
        ? hour === 12
          ? 12
          : hour + 12
        : hour === 12
          ? 0
          : hour;
    return `${String(converted).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  };
  const meridiem = String.raw`([ap])\\s*\\.?\\s*m\\.?`;
  const hour = String.raw`(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|1[0-2]|0?[1-9])`;

  if (/\\bnoon\\b/i.test(text)) return { time: "12:00", ambiguous: false };
  if (/\\bmidnight\\b/i.test(text)) return { time: "00:00", ambiguous: false };

  // Match complete spoken-clock expressions before generic numeric clocks.
  // Otherwise "a quarter to 5 p.m." is prematurely consumed as "5 p.m.".
  const named = text.match(
    new RegExp(
      String.raw`\\b(?:a\\s+)?(half past|quarter past|quarter to)\\s+${hour}(?:\\s*${meridiem})?(?=\\s|[,.!?;:]|$)`,
      "i",
    ),
  );
  if (named) {
    const phrase = named[1].toLowerCase();
    const targetHour = toHour(named[2]);
    let marker = named[3];
    const minute =
      phrase === "half past" ? 30 : phrase === "quarter past" ? 15 : 45;

    if (phrase === "quarter to") {
      // "Quarter to 12 PM" is 11:45 AM. "Quarter to 12 AM" crosses into
      // the previous calendar day; the time-only parser cannot safely apply
      // that date correction, so force clarification instead of scheduling
      // the wrong day.
      if (targetHour === 12 && marker?.toLowerCase() === "a")
        return { time: null, ambiguous: true };
      if (targetHour === 12 && marker?.toLowerCase() === "p") marker = "a";
      const priorHour = targetHour === 1 ? 12 : targetHour - 1;
      const time = normalized(priorHour, minute, marker);
      return { time, ambiguous: !marker };
    }

    const time = normalized(targetHour, minute, marker);
    return { time, ambiguous: !marker };
  }

  const spoken = text.match(
    new RegExp(
      String.raw`\\b(?:at\\s+)?${hour}\\s+(fifteen|thirty|forty[- ]five)\\s*${meridiem}(?=\\s|[,.!?;:]|$)`,
      "i",
    ),
  );
  if (spoken) {
    const minute = spoken[2].toLowerCase().startsWith("fifteen")
      ? 15
      : spoken[2].toLowerCase().startsWith("thirty")
        ? 30
        : 45;
    return {
      time: normalized(toHour(spoken[1]), minute, spoken[3]),
      ambiguous: false,
    };
  }

  const clock = text.match(
    new RegExp(
      String.raw`\\b(?:at\\s*)?(1[0-2]|0?[1-9])(?::([0-5]\\d))?\\s*${meridiem}(?=\\s|[,.!?;:]|$)`,
      "i",
    ),
  );
  if (clock)
    return {
      time: normalized(Number(clock[1]), Number(clock[2] ?? 0), clock[3]),
      ambiguous: false,
    };

  const daypart = text.match(
    /\\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|1[0-2])\\s+(?:in\\s+the\\s+)?(morning|afternoon|evening|night)\\b/i,
  );
  if (daypart) {
    let daypartHour = toHour(daypart[1]);
    const part = daypart[2].toLowerCase();
    if ((part === "afternoon" || part === "evening") && daypartHour < 12)
      daypartHour += 12;
    if (part === "morning" && daypartHour === 12) daypartHour = 0;
    return {
      time: `${String(daypartHour).padStart(2, "0")}:00`,
      ambiguous: false,
    };
  }

  const ambiguousClock = new RegExp(
    String.raw`\\b(?:(?:a\\s+)?(?:half past|quarter past|quarter to)\\s+${hour}|${hour}\\s+(?:fifteen|thirty|forty[- ]five))\\b`,
    "i",
  ).test(text);
  return { time: null, ambiguous: ambiguousClock };
}

function durationMinutesFromText(text: string) {
  if (/\bin\s+(?:an?|one)\s+hour\s+and\s+a\s+half\b/i.test(text)) return 90;
  const match = text.match(
    /\bin\s+((?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|ninety)|\d+)\s+(minutes?|hours?)\b/i,
  );
  if (!match) return null;
  const amount = numberFromText(match[1]);
  if (!amount || amount > 1440) return null;
  return amount * (match[2].toLowerCase().startsWith("hour") ? 60 : 1);
}

/**
 * Central, deterministic Phase C language extraction. It returns only values
 * that the CalendarExpression resolver can validate; unknown phrasing remains
 * unanswered for the conversation manager to clarify.
 */
export function calendarLanguageFieldsFromText(
  text: string,
  expression: CalendarExpression,
): CalendarLanguageFields {
  const time = naturalTimeFromText(text);
  const duration = durationMinutesFromText(text);
  if (duration !== null) {
    const resolved = resolveCalendarExpression(expression);
    const base =
      resolved.kind === "resolved"
        ? new Date(resolved.instant)
        : new Date(expression.referenceInstant);
    const target = localDateTimeParts(
      new Date(base.getTime() + duration * 60_000),
      expression.timeZone,
    );
    return {
      date: isoDate(target),
      time: `${String(target.hour).padStart(2, "0")}:${String(target.minute).padStart(2, "0")}`,
      relative: null,
      replacesDateConstraint: true,
      hasAmbiguousTime: false,
    };
  }

  const explicitWithOffset = text.match(
    /\b((?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)|\d+)\s+(day|days|week|weeks|month|months|year|years)\s+(before|after)\s+(?:an?\s+)?(?:the\s+)?(?:date\s+)?/i,
  );
  if (explicitWithOffset) {
    const tail = text.slice(
      (explicitWithOffset.index ?? 0) + explicitWithOffset[0].length,
    );
    const base = explicitDateFromText(tail, expression);
    const unitText = explicitWithOffset[2].toLowerCase();
    const unit = unitText.startsWith("day")
      ? "days"
      : unitText.startsWith("week")
        ? "weeks"
        : unitText.startsWith("month")
          ? "months"
          : "years";
    const shifted =
      base &&
      addToDate(
        base,
        (explicitWithOffset[3].toLowerCase() === "before" ? -1 : 1) *
          numberFromText(explicitWithOffset[1]),
        unit,
      );
    if (shifted)
      return {
        date: shifted,
        time: time.time,
        relative: null,
        replacesDateConstraint: true,
        hasAmbiguousTime: time.ambiguous,
      };
  }

  const nextWeekdayOffset = text.match(
    /\b((?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)|\d+)\s+(day|days|week|weeks|month|months|year|years)\s+from\s+next\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i,
  );
  if (nextWeekdayOffset) {
    const weekday = weekdayNames.indexOf(nextWeekdayOffset[3].toLowerCase());
    const base = weekdayFromReference(expression, weekday, "next");
    const unitText = nextWeekdayOffset[2].toLowerCase();
    const unit = unitText.startsWith("day")
      ? "days"
      : unitText.startsWith("week")
        ? "weeks"
        : unitText.startsWith("month")
          ? "months"
          : "years";
    return {
      date: addToDate(base, numberFromText(nextWeekdayOffset[1]), unit),
      time: time.time,
      relative: null,
      replacesDateConstraint: true,
      hasAmbiguousTime: time.ambiguous,
    };
  }

  if (/\ba\s+week\s+from\s+tomorrow\b/i.test(text))
    return {
      date: null,
      time: time.time,
      relative: relativeFromDays(8),
      replacesDateConstraint: true,
      hasAmbiguousTime: time.ambiguous,
    };

  const weekdayMatch = text.match(
    /\b(this|next)\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i,
  );
  const afterNext = text.match(
    /\b(?:the\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\s+after\s+next\b/i,
  );
  if (afterNext || weekdayMatch) {
    const name = (afterNext?.[1] ?? weekdayMatch?.[2] ?? "").toLowerCase();
    const mode = afterNext
      ? "after_next"
      : weekdayMatch?.[1]?.toLowerCase() === "this"
        ? "this"
        : "next";
    return {
      date: weekdayFromReference(expression, weekdayNames.indexOf(name), mode),
      time: time.time,
      relative: null,
      replacesDateConstraint: true,
      hasAmbiguousTime: time.ambiguous,
    };
  }

  const relative = relativeDateExpressionFromText(text);
  if (relative)
    return {
      date: null,
      time: time.time,
      relative,
      replacesDateConstraint: true,
      hasAmbiguousTime: time.ambiguous,
    };
  if (/\bday after tomorrow\b/i.test(text))
    return {
      date: null,
      time: time.time,
      relative: relativeFromDays(2),
      replacesDateConstraint: true,
      hasAmbiguousTime: time.ambiguous,
    };
  if (/\btoday\b/i.test(text))
    return {
      date: null,
      time: time.time,
      relative: relativeFromDays(0),
      replacesDateConstraint: true,
      hasAmbiguousTime: time.ambiguous,
    };

  const explicit = explicitDateFromText(text, expression);
  return {
    date: explicit,
    time: time.time,
    relative: null,
    replacesDateConstraint: false,
    hasAmbiguousTime: time.ambiguous,
  };
}

/** A scheduling correction must never be acknowledged if no deterministic field was understood. */
export function hasSchedulingCorrectionLanguage(text: string) {
  return /\b(?:actually|change|move|make|reschedule)\b/i.test(text);
}

export function createCalendarExpression(
  timeZone: string,
  now = new Date(),
): CalendarExpression {
  return {
    version: 1,
    timeZone,
    referenceInstant: now.toISOString(),
    date: {
      absolute: null,
      implicitYear: false,
      constraint: null,
      relative: null,
      range: null,
    },
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
  expression.date.implicitYear = false;
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
    update.relative !== undefined && update.relative !== null
      ? null
      : update.constraint === undefined
        ? base.date.constraint
        : update.constraint === null
          ? null
          : mergeConstraints(base.date.constraint, update.constraint);
  const replacesDateThroughConstraint =
    update.constraint !== undefined && update.constraint !== null;
  const replacesDateThroughRelative =
    update.relative !== undefined && update.relative !== null;
  return {
    ...base,
    date: {
      ...base.date,
      // A new ordinal/weekday constraint is a correction to the prior exact date.
      // A relative correction keeps an existing absolute date only when its
      // language says "later", which is explicitly anchored to that reminder.
      absolute: replacesDateThroughConstraint
        ? null
        : replacesDateThroughRelative &&
            update.relative?.anchor !== "existing_reminder_date"
          ? null
          : update.date === undefined
            ? base.date.absolute
            : update.date,
      implicitYear:
        replacesDateThroughConstraint || replacesDateThroughRelative
          ? false
          : update.date === undefined
            ? base.date.implicitYear
            : (update.implicitYear ?? false),
      constraint,
      relative:
        replacesDateThroughConstraint || update.date !== undefined
          ? null
          : update.relative === undefined
            ? base.date.relative
            : update.relative,
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

function referenceDate(expression: CalendarExpression) {
  return localDateParts(
    new Date(expression.referenceInstant),
    expression.timeZone,
  );
}

/**
 * A missing year on a month/weekday expression means the next occurrence,
 * calculated from the draft's frozen local reference date. The returned
 * constraint is a resolver value only: the stored expression keeps `year:
 * null` to preserve what the user actually said.
 */
function constraintWithImplicitYear(
  expression: CalendarExpression,
  constraint: DateConstraint,
) {
  if (constraint.year !== null || constraint.month === null)
    return { constraint, unavailable: null as number | null };
  const reference = referenceDate(expression);
  let year = reference.year + (constraint.month < reference.month ? 1 : 0);
  const candidate = { ...constraint, year };
  if (
    constraint.month !== reference.month ||
    constraint.weekday === null ||
    constraint.occurrence === null
  )
    return { constraint: candidate, unavailable: null as number | null };

  // A nonexistent fifth weekday is invalid for the month being discussed, not
  // a reason to quietly search a different year.
  const current = calendarDateForWeekdayOccurrence(
    year,
    constraint.month,
    constraint.weekday,
    constraint.occurrence,
  );
  if (!current.date)
    return { constraint: candidate, unavailable: current.occurrenceCount };
  const referenceIso = isoDate(reference);
  let hasPassed = current.date < referenceIso;
  if (
    !hasPassed &&
    current.date === referenceIso &&
    expression.time.local &&
    timeIsValid(expression.time.local)
  ) {
    try {
      hasPassed =
        new Date(
          fromLocalInput(
            `${current.date}T${expression.time.local}`,
            expression.timeZone,
          ),
        ).getTime() < new Date(expression.referenceInstant).getTime();
    } catch {
      // The normal resolver produces the local-time error below.
    }
  }
  if (hasPassed) year += 1;
  return {
    constraint: { ...constraint, year },
    unavailable: null as number | null,
  };
}

function resolveImplicitAbsoluteDate(
  expression: CalendarExpression,
  date: string,
) {
  const parsed = parseIsoDate(date);
  if (!parsed) return null;
  const reference = referenceDate(expression);
  let year = reference.year;
  let candidate = isoDate({ year, month: parsed.month, day: parsed.day });
  if (!dateIsValid(candidate)) return null;
  const referenceIso = isoDate(reference);
  let hasPassed = candidate < referenceIso;
  if (
    !hasPassed &&
    candidate === referenceIso &&
    expression.time.local &&
    timeIsValid(expression.time.local)
  ) {
    try {
      hasPassed =
        new Date(
          fromLocalInput(
            `${candidate}T${expression.time.local}`,
            expression.timeZone,
          ),
        ).getTime() < new Date(expression.referenceInstant).getTime();
    } catch {
      // The normal resolver returns the invalid-local-time outcome.
    }
  }
  if (hasPassed) {
    year += 1;
    candidate = isoDate({ year, month: parsed.month, day: parsed.day });
    if (!dateIsValid(candidate)) return null;
  }
  return candidate;
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
  if (date && expression.date.implicitYear) {
    date = resolveImplicitAbsoluteDate(expression, date);
    if (!date) return { kind: "invalid", reason: "invalid_date" };
  }
  if (expression.date.relative) {
    const relative = expression.date.relative;
    const base =
      relative.anchor === "existing_reminder_date"
        ? date && parseIsoDate(date)
        : localDateParts(
            new Date(expression.referenceInstant),
            expression.timeZone,
          );
    if (!base)
      return {
        kind: "ambiguous",
        ambiguities: [
          {
            field: "date",
            reason: "a reminder date is needed before using later",
          },
        ],
      };
    date = addRelativeDate(base, relative);
  }
  const constraint = expression.date.constraint;
  if (constraint) {
    const implicit = constraintWithImplicitYear(expression, constraint);
    const resolvedConstraint = implicit.constraint;
    if (implicit.unavailable !== null)
      return {
        kind: "invalid",
        reason: "unavailable_occurrence",
        occurrenceCount: implicit.unavailable,
        constraint: resolvedConstraint,
      };
    if (date && !matchesDateConstraint(date, resolvedConstraint))
      return {
        kind: "invalid",
        reason: "constraint_conflict",
        constraint: resolvedConstraint,
      };
    if (!date) {
      const resolution = resolveDateConstraint(resolvedConstraint);
      if (resolution.status === "incomplete")
        return {
          kind: "ambiguous",
          ambiguities: constraintMissing(resolvedConstraint).map((field) => ({
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
          constraint: resolvedConstraint,
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
    const instant = fromLocalInput(
      `${resolvedDate}T${resolvedTime}`,
      expression.timeZone,
    );
    if (
      new Date(instant).getTime() <
      new Date(expression.referenceInstant).getTime()
    )
      return { kind: "invalid", reason: "past_date" };
    return {
      kind: "resolved",
      date: resolvedDate,
      time: resolvedTime,
      instant,
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
      : resolution.reason === "past_date"
        ? "That time has already passed. What future date or time should I use?"
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
  if (
    !nullableString(parsedDate.absolute) ||
    !nullableString(parsedTime.local) ||
    (parsedDate.implicitYear !== undefined &&
      typeof parsedDate.implicitYear !== "boolean")
  )
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
  const relative = parsedDate.relative;
  const validRelative =
    relative === null ||
    (typeof relative === "object" &&
      !Array.isArray(relative) &&
      (() => {
        const item = relative as Record<string, unknown>;
        return (
          item.kind === "calendar_offset" &&
          Number.isInteger(item.amount) &&
          (item.amount as number) >= -99 &&
          (item.amount as number) <= 99 &&
          (item.unit === "days" ||
            item.unit === "weeks" ||
            item.unit === "months" ||
            item.unit === "years") &&
          (item.anchor === "reference_day" ||
            item.anchor === "existing_reminder_date")
        );
      })());
  if (!validRelative) throw new Error("Invalid calendar expression.");
  // Phase B only serializes the supported one-time subset. Reject arbitrary new shapes.
  if (
    parsedDate.range !== null ||
    source.offset !== null ||
    source.recurrence !== null ||
    !Array.isArray(source.exceptions) ||
    !Array.isArray(source.ambiguities) ||
    !Array.isArray(source.correctionTargets)
  )
    throw new Error("Invalid calendar expression.");
  return {
    ...(value as CalendarExpression),
    date: {
      ...(parsedDate as CalendarExpression["date"]),
      // Context created before this repair has no metadata and remains safe.
      implicitYear: parsedDate.implicitYear === true,
    },
  };
}

export type { DateConstraint, WeekdayOccurrence };
