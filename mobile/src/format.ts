export function taskDateTimeLabel(iso: string, timeZone: string) {
  if (!iso) return "No time set";
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

export function errorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (/network|fetch|offline|reach/i.test(message))
    return "Could not reach LeadLoop cloud. Check your connection and try again.";
  if (/permission|42501|not allowed/i.test(message))
    return "LeadLoop could not verify workspace access. Check your connection and retry; your current workspace remains selected.";
  return message || "Something went wrong. Please try again.";
}
