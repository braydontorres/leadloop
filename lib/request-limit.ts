import { ApiError } from "./ai-server";

export type RateLimitConfig = {
  windowMs: number;
  maxRequests: number;
};

export type RequestPermit = {
  clientId: string;
  timestamp: number;
};

const productionConfig: RateLimitConfig = {
  windowMs: 10 * 60 * 1000,
  maxRequests: 12,
};

const developmentConfig: RateLimitConfig = {
  windowMs: 10 * 60 * 1000,
  maxRequests: 60,
};

const attempts = new Map<string, number[]>();

export function currentRateLimitConfig(): RateLimitConfig {
  return process.env.NODE_ENV === "development"
    ? developmentConfig
    : productionConfig;
}

export function limitRequest(
  clientId: string,
  now = Date.now(),
  config = currentRateLimitConfig(),
): RequestPermit {
  const recent = (attempts.get(clientId) ?? []).filter(
    (time) => now - time < config.windowMs,
  );
  if (recent.length >= config.maxRequests) {
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((config.windowMs - (now - recent[0])) / 1000),
    );
    attempts.set(clientId, recent);
    throw new ApiError(
      "LeadLoop is receiving too many requests. Please try again shortly.",
      429,
      "LOCAL_RATE_LIMIT",
      undefined,
      retryAfterSeconds,
      "internal",
    );
  }
  recent.push(now);
  attempts.set(clientId, recent);
  return { clientId, timestamp: now };
}

export function releaseRequest(permit: RequestPermit) {
  const recent = attempts.get(permit.clientId);
  if (!recent) return;
  const index = recent.lastIndexOf(permit.timestamp);
  if (index !== -1) recent.splice(index, 1);
  if (recent.length) attempts.set(permit.clientId, recent);
  else attempts.delete(permit.clientId);
}

export function resetRateLimitsForTest() {
  attempts.clear();
}

export function clientId(headers: Headers) {
  return (
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    headers.get("x-real-ip") ||
    "local"
  );
}
