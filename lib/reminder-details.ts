export type DateConstraint = {
  year: number | null;
  month: number | null;
  weekday: number | null;
  occurrence: WeekdayOccurrence | null;
};

export type WeekdayOccurrence = 1 | 2 | 3 | 4 | 5 | "last" | "second_to_last";

export type DateConstraintResolution =
  | { status: "incomplete" }
  | { status: "resolved"; date: string }
  | { status: "unavailable"; occurrenceCount: number };

const months = [
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
const weekdays = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

function localParts(now: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  return { year: value("year"), month: value("month"), day: value("day") };
}

export function isMeaningfulReminderTitle(value: string | null) {
  if (!value?.trim()) return false;
  const normalized = value
    .toLowerCase()
    .replace(/[.,!?]+$/g, "")
    .trim();
  if (
    [
      "reminder",
      "a reminder",
      "set a reminder",
      "set a reminder for",
      "i want a reminder",
      "i want a reminder for",
      "remind me",
      "remind me to",
    ].includes(normalized)
  )
    return false;
  const withoutReminderPrefix = normalized
    .replace(
      /^(?:(?:please\s+)?(?:i want|i need|set|create)(?:\s+a)?\s+reminder(?:\s+for)?|remind me(?:\s+to)?)\s*/i,
      "",
    )
    .trim();
  if (!withoutReminderPrefix) return false;
  return !/^(?:(?:next\s+)?(?:january|february|march|april|may|june|july|august|september|october|november|december|sunday|monday|tuesday|wednesday|thursday|friday|saturday)|today|tomorrow|on|in|at|a|an|\d{1,2}|\d{4}|am|pm|noon|midnight|and|the|of|first|second|third|fourth|fifth|last|one|to|\s|-)+$/i.test(
    withoutReminderPrefix,
  );
}

/** Removes a trailing, clearly scheduling-only phrase from an extracted task title. */
export function cleanReminderTitle(value: string | null) {
  if (!value?.trim()) return null;
  const monthPattern = months.join("|");
  const weekdayPattern = weekdays.join("|");
  const ordinalPattern =
    "(?:first|second|third|fourth|fifth|last|second[- ]to[- ]last|[1-5](?:st|nd|rd|th))";
  const timePattern =
    "(?:at\\s+)?(?:1[0-2]|0?[1-9])(?::[0-5]\\d)?\\s*(?:a\\.?m\\.?|p\\.?m\\.?)|(?:noon|midnight)";
  let cleaned = value.trim();
  cleaned = cleaned.replace(
    new RegExp(
      `\\s+(?:on\\s+)?(?:a\\s+|the\\s+)?(?:${ordinalPattern}\\s+)?(?:next\\s+)?(?:${weekdayPattern})(?:\\s+(?:in\\s+)?(?:next\\s+)?(?:${monthPattern}))?(?:\\s+(?:at\\s+)?${timePattern})?[,.!?]*$`,
      "i",
    ),
    "",
  );
  cleaned = cleaned.replace(
    new RegExp(
      `\\s+(?:on\\s+)?(?:today|tomorrow|next\\s+(?:week|month|year))(?:\\s+(?:at\\s+)?${timePattern})?[,.!?]*$`,
      "i",
    ),
    "",
  );
  cleaned = cleaned.replace(/[,.!?\s]+$/, "").trim();
  return isMeaningfulReminderTitle(cleaned) ? cleaned : null;
}

export function weekdayOccurrenceFromText(
  text: string,
): WeekdayOccurrence | null {
  if (/\bsecond(?:\s*[- ]\s*to|\s+to)\s*[- ]?last\b/i.test(text))
    return "second_to_last";
  if (/\blast\b/i.test(text)) return "last";
  const names: Array<[RegExp, WeekdayOccurrence]> = [
    [/\b(?:first|1st)(?:\s+one)?\b/i, 1],
    [/\b(?:second|2nd)(?:\s+one)?\b/i, 2],
    [/\b(?:third|3rd)(?:\s+one)?\b/i, 3],
    [/\b(?:fourth|4th)(?:\s+one)?\b/i, 4],
    [/\b(?:fifth|5th)(?:\s+one)?\b/i, 5],
  ];
  return names.find(([expression]) => expression.test(text))?.[1] ?? null;
}

export function deterministicTimeFromText(text: string) {
  if (/\bnoon\b/i.test(text)) return "12:00";
  if (/\bmidnight\b/i.test(text)) return "00:00";
  const clock = text.match(
    /\b(?:at\s*)?(1[0-2]|0?[1-9])(?::([0-5]\d))?\s*([ap])\.?m\.?\b/i,
  );
  if (clock) {
    let hour = Number(clock[1]);
    if (clock[3].toLowerCase() === "p" && hour !== 12) hour += 12;
    if (clock[3].toLowerCase() === "a" && hour === 12) hour = 0;
    return `${String(hour).padStart(2, "0")}:${clock[2] ?? "00"}`;
  }
  const wordHours: Record<string, number> = {
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
  };
  const daypart = text.match(
    /\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|1[0-2]|0?[1-9])\s+(?:in\s+the\s+)?(morning|afternoon|evening|night)\b/i,
  );
  if (!daypart) return null;
  let hour = wordHours[daypart[1].toLowerCase()] ?? Number(daypart[1]);
  const part = daypart[2].toLowerCase();
  if ((part === "afternoon" || part === "evening") && hour < 12) hour += 12;
  if (part === "morning" && hour === 12) hour = 0;
  return `${String(hour).padStart(2, "0")}:00`;
}

export function mentionsExplicitTime(text: string) {
  return deterministicTimeFromText(text) !== null;
}

export function deriveDateConstraint(
  text: string,
  timeZone: string,
  now = new Date(),
): DateConstraint | null {
  const monthIndex = months.findIndex((month) =>
    new RegExp(`\\b${month}\\b`, "i").test(text),
  );
  const weekdayIndex = weekdays.findIndex((weekday) =>
    new RegExp(`\\b${weekday}\\b`, "i").test(text),
  );
  const occurrence = weekdayOccurrenceFromText(text);
  if (monthIndex < 0 && weekdayIndex < 0 && occurrence === null) return null;
  // A numbered day makes this an exact date, not a month/weekday constraint.
  if (
    monthIndex >= 0 &&
    new RegExp(`\\b${months[monthIndex]}\\s+\\d{1,2}\\b`, "i").test(text)
  )
    return null;
  const local = localParts(now, timeZone);
  const next = /\bnext\b/i.test(text);
  const explicitYear = text.match(/\b(20\d{2})\b/);
  const year = explicitYear
    ? Number(explicitYear[1])
    : next && monthIndex >= 0
      ? local.year + (monthIndex + 1 <= local.month ? 1 : 0)
      : null;
  return {
    year,
    month: monthIndex >= 0 ? monthIndex + 1 : null,
    weekday: weekdayIndex >= 0 ? weekdayIndex : null,
    occurrence,
  };
}

export function mergeDateConstraints(
  current: DateConstraint | null,
  update: DateConstraint | null,
): DateConstraint | null {
  if (!current) return update;
  if (!update) return current;
  return {
    year: update.year ?? current.year,
    month: update.month ?? current.month,
    weekday: update.weekday ?? current.weekday,
    occurrence: update.occurrence ?? current.occurrence,
  };
}

export function explicitMonthDay(
  text: string,
  constraint: DateConstraint | null,
) {
  const match = text.match(
    new RegExp(
      `\\b(${months.join("|")})\\s+(\\d{1,2})(?:,?\\s*(20\\d{2}))?\\b`,
      "i",
    ),
  );
  if (!match) return null;
  const month = months.indexOf(match[1].toLowerCase()) + 1;
  const day = Number(match[2]);
  const year = match[3]
    ? Number(match[3])
    : (constraint?.year ?? new Date().getUTCFullYear());
  const timestamp = Date.UTC(year, month - 1, day);
  const date = new Date(timestamp);
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() + 1 !== month ||
    date.getUTCDate() !== day
  )
    return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function dateString(year: number, month: number, day: number) {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() + 1 !== month ||
    date.getUTCDate() !== day
  )
    return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function weekdayOccurrenceCount(
  year: number,
  month: number,
  weekday: number,
) {
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(weekday) ||
    month < 1 ||
    month > 12 ||
    weekday < 0 ||
    weekday > 6
  )
    return 0;
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  let count = 0;
  for (let day = 1; day <= days; day += 1)
    if (new Date(Date.UTC(year, month - 1, day)).getUTCDay() === weekday)
      count += 1;
  return count;
}

/** Resolves an ordinal weekday without trusting an AI-generated calendar date. */
export function calendarDateForWeekdayOccurrence(
  year: number,
  month: number,
  weekday: number,
  occurrence: WeekdayOccurrence,
) {
  const occurrenceCount = weekdayOccurrenceCount(year, month, weekday);
  const requested =
    occurrence === "last"
      ? occurrenceCount
      : occurrence === "second_to_last"
        ? occurrenceCount - 1
        : occurrence;
  if (requested < 1 || requested > occurrenceCount)
    return { date: null, occurrenceCount };
  const firstWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const day = 1 + ((weekday - firstWeekday + 7) % 7) + (requested - 1) * 7;
  return { date: dateString(year, month, day), occurrenceCount };
}

export function resolveDateConstraint(
  constraint: DateConstraint,
): DateConstraintResolution {
  if (
    constraint.year === null ||
    constraint.month === null ||
    constraint.weekday === null ||
    constraint.occurrence === null
  )
    return { status: "incomplete" };
  const result = calendarDateForWeekdayOccurrence(
    constraint.year,
    constraint.month,
    constraint.weekday,
    constraint.occurrence,
  );
  return result.date
    ? { status: "resolved", date: result.date }
    : { status: "unavailable", occurrenceCount: result.occurrenceCount };
}

export function deterministicDateFromText(
  text: string,
  timeZone: string,
  constraint: DateConstraint | null,
  now = new Date(),
) {
  const iso = text.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  if (iso) return iso[1];
  const monthDay = explicitMonthDay(text, constraint);
  if (monthDay && constraint?.year !== null) return monthDay;
  const local = localParts(now, timeZone);
  if (/\btoday\b/i.test(text))
    return dateString(local.year, local.month, local.day);
  if (/\btomorrow\b/i.test(text)) {
    const tomorrow = new Date(
      Date.UTC(local.year, local.month - 1, local.day + 1),
    );
    return dateString(
      tomorrow.getUTCFullYear(),
      tomorrow.getUTCMonth() + 1,
      tomorrow.getUTCDate(),
    );
  }
  const nextWeekday = weekdays.findIndex((weekday) =>
    new RegExp(`\\bnext\\s+${weekday}\\b`, "i").test(text),
  );
  if (nextWeekday >= 0) {
    const current = new Date(Date.UTC(local.year, local.month - 1, local.day));
    const days = (nextWeekday - current.getUTCDay() + 7) % 7 || 7;
    current.setUTCDate(current.getUTCDate() + days);
    return dateString(
      current.getUTCFullYear(),
      current.getUTCMonth() + 1,
      current.getUTCDate(),
    );
  }
  return null;
}

export function matchesDateConstraint(
  date: string,
  constraint: DateConstraint | null,
) {
  if (!constraint) return true;
  const match = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const [year, month, day] = match.slice(1).map(Number);
  const timestamp = Date.UTC(year, month - 1, day);
  const actual = new Date(timestamp);
  if (
    actual.getUTCFullYear() !== year ||
    actual.getUTCMonth() + 1 !== month ||
    actual.getUTCDate() !== day
  )
    return false;
  return (
    (constraint.year === null || constraint.year === year) &&
    (constraint.month === null || constraint.month === month) &&
    (constraint.weekday === null || constraint.weekday === actual.getUTCDay())
  );
}

export function dateConstraintQuestion(constraint: DateConstraint) {
  const title = (value: string) => value[0].toUpperCase() + value.slice(1);
  if (constraint.month !== null && constraint.weekday === null)
    return `Which date in ${title(months[constraint.month - 1])}`;
  if (constraint.month === null && constraint.weekday !== null)
    return `Which month should I use for that ${title(weekdays[constraint.weekday])}`;
  const weekday =
    constraint.weekday === null ? "date" : title(weekdays[constraint.weekday]);
  const month =
    constraint.month === null
      ? ""
      : ` in ${title(months[constraint.month - 1])}`;
  return `Which ${weekday}${month}`;
}

export function mentionsUnambiguousDate(text: string) {
  return /\b(?:today|tomorrow|next\s+(?:sunday|monday|tuesday|wednesday|thursday|friday|saturday))\b|\b20\d{2}-\d{2}-\d{2}\b|\b(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2}\b/i.test(
    text,
  );
}
