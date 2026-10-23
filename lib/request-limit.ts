import { ApiError } from "./ai-server";

export type RateLimitConfig = {
  windowMs: number;
  maxRequests: number;
};

export type RequestPermit = {
  clientId: string;
  timestamp: number;
};

export type MobileSpeechRequestKind = "assistant_reply" | "preview";

const productionConfig: RateLimitConfig = {
  windowMs: 10 * 60 * 1000,
  maxRequests: 12,
};

const developmentConfig: RateLimitConfig = {
  windowMs: 10 * 60 * 1000,
  maxRequests: 60,
};

const mobileSpeechDefaults: Record<
  "production" | "development",
  Record<MobileSpeechRequestKind, RateLimitConfig>
> = {
  production: {
    // A normal reminder conversation needs several replies. Keep enough room
    // for several conversations while retaining a bounded per-user cost cap.
    assistant_reply: { windowMs: 10 * 60 * 1000, maxRequests: 30 },
    // Voice selection is useful, but must not consume conversational capacity.
    preview: { windowMs: 10 * 60 * 1000, maxRequests: 6 },
  },
  development: {
    assistant_reply: { windowMs: 10 * 60 * 1000, maxRequests: 120 },
    preview: { windowMs: 10 * 60 * 1000, maxRequests: 24 },
  },
};

function boundedPositiveInteger(
  value: string | undefined,
  fallback: number,
  min: number,
  max: number,
) {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max
    ? parsed
    : fallback;
}

const attempts = new Map<string, number[]>();

export function currentRateLimitConfig(): RateLimitConfig {
  return process.env.NODE_ENV === "development"
    ? developmentConfig
    : productionConfig;
}

/**
 * Natural previews and real assistant replies deliberately use separate
 * authenticated-user buckets. Server-only environment values permit a deploy
 * owner to tighten or expand the policy without shipping an iPhone bundle.
 */
export function mobileSpeechRateLimitConfig(
  kind: MobileSpeechRequestKind,
  env: NodeJS.ProcessEnv = process.env,
): RateLimitConfig {
  const mode = env.NODE_ENV === "development" ? "development" : "production";
  const fallback = mobileSpeechDefaults[mode][kind];
  const prefix =
    kind === "assistant_reply"
      ? "LEADLOOP_MOBILE_SPEECH_REPLY"
      : "LEADLOOP_MOBILE_SPEECH_PREVIEW";
  return {
    windowMs:
      boundedPositiveInteger(
        env[`${prefix}_WINDOW_SECONDS`],
        fallback.windowMs / 1000,
        60,
        3_600,
      ) * 1000,
    maxRequests: boundedPositiveInteger(
      env[`${prefix}_MAX_REQUESTS`],
      fallback.maxRequests,
      1,
      240,
    ),
  };
}

export function mobileSpeechLimitKey(
  userId: string,
  kind: MobileSpeechRequestKind,
) {
  return `mobile-speech:${kind}:${userId}`;
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
