import { ApiError } from "./ai-server";

const WINDOW_MS = 10 * 60 * 1000;
const MAX_REQUESTS = 12;
const attempts = new Map<string, number[]>();

export function limitRequest(clientId: string) {
  const now = Date.now();
  const recent = (attempts.get(clientId) ?? []).filter(
    (time) => now - time < WINDOW_MS,
  );
  if (recent.length >= MAX_REQUESTS)
    throw new ApiError(
      "Too many voice or AI requests. Please wait a few minutes.",
      429,
      "LOCAL_RATE_LIMIT",
    );
  recent.push(now);
  attempts.set(clientId, recent);
}

export function clientId(headers: Headers) {
  return headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
}
