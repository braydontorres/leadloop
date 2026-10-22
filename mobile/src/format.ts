export function taskDateTimeLabel(iso: string, timeZone: string) {
  if (!iso) return "No time set";
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(iso));
}

export function errorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (/network|fetch|offline|reach/i.test(message))
    return "Could not reach LeadLoop cloud. Check your connection and try again.";
  if (/42501|row-level security|not allowed/i.test(message))
    return "Cloud request was denied. Retry the action after the current session finishes restoring.";
  return message || "Something went wrong. Please try again.";
}
