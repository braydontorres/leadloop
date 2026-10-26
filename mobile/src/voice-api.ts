import type { SupabaseClient } from "@supabase/supabase-js";
import { File } from "expo-file-system";
import { fetch as expoFetch } from "expo/fetch";
import type { IntentResult } from "../../lib/conversation-machine";
import { mobileVoiceConfig } from "./config";
import {
  isVoiceTimeout,
  voiceHttpError,
  voiceTimeoutError,
} from "./voice-response";
import { mobileVoiceAuthorizationHeaders } from "./voice-auth";
import { currentMobileVoiceAccessToken } from "./voice-session";
import { appendExpoAudioFile } from "./voice-upload";

const config = mobileVoiceConfig(process.env);
const REQUEST_TIMEOUT_MS = 35_000;

export type MobileVoiceServerTiming = {
  formDataMs: number;
  authorizationMs: number;
  validationMs: number;
  transcriptionMs: number;
  interpretationMs: number;
  interpretationSource: "openai" | "confirmation_fast_path";
  audioBytes: number;
  durationMs: number;
  totalMs: number;
};

export type MobileVoiceClientTiming = {
  sessionMs: number;
  requestSetupMs: number;
  requestRoundTripMs: number;
  responseParseMs: number;
  totalMs: number;
  audioBytes: number | null;
  server?: MobileVoiceServerTiming;
};

export type MobileVoiceResponse = {
  transcript: string;
  result: IntentResult;
  timing: MobileVoiceClientTiming;
};

function validServerTiming(value: unknown): value is MobileVoiceServerTiming {
  if (!value || typeof value !== "object") return false;
  const timing = value as Record<string, unknown>;
  return (
    [
      "formDataMs",
      "authorizationMs",
      "validationMs",
      "transcriptionMs",
      "interpretationMs",
      "audioBytes",
      "durationMs",
      "totalMs",
    ].every(
      (key) =>
        typeof timing[key] === "number" &&
        Number.isFinite(timing[key]) &&
        timing[key] >= 0,
    ) &&
    (timing.interpretationSource === "openai" ||
      timing.interpretationSource === "confirmation_fast_path")
  );
}

export async function uploadMobileVoiceTurn(input: {
  client: SupabaseClient;
  workspaceId: string;
  audioUri: string;
  durationMs: number;
  timeZone: string;
  context: unknown;
  onTiming?(timing: MobileVoiceClientTiming): void;
}): Promise<MobileVoiceResponse> {
  if (!config)
    throw new Error(
      "Voice processing is not configured. Add EXPO_PUBLIC_LEADLOOP_VOICE_API_URL, or use the typed reminder form.",
    );
  const startedAt = Date.now();
  let sessionMs = 0;
  let requestSetupMs = 0;
  let requestRoundTripMs = 0;
  let responseParseMs = 0;
  let audioBytes: number | null = null;
  let emittedTiming = false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const sessionStartedAt = Date.now();
    const accessToken = await currentMobileVoiceAccessToken(input.client);
    sessionMs = Date.now() - sessionStartedAt;
    const setupStartedAt = Date.now();
    const body = new FormData();
    body.append("workspaceId", input.workspaceId);
    body.append("timeZone", input.timeZone);
    body.append(
      "durationMs",
      String(Math.max(0, Math.round(input.durationMs))),
    );
    body.append("context", JSON.stringify(input.context));
    const audioFile = new File(input.audioUri);
    audioBytes = audioFile.size;
    appendExpoAudioFile(body, audioFile);
    requestSetupMs = Date.now() - setupStartedAt;
    // Expo's fetch recognizes FileSystem File and generates the multipart
    // boundary itself. Do not set Content-Type manually.
    const requestStartedAt = Date.now();
    const response = await expoFetch(`${config.apiBaseUrl}/api/mobile/voice`, {
      method: "POST",
      headers: mobileVoiceAuthorizationHeaders(accessToken),
      body,
      signal: controller.signal,
    });
    requestRoundTripMs = Date.now() - requestStartedAt;
    const responseStartedAt = Date.now();
    const payload = (await response.json().catch(() => ({}))) as {
      error?: string;
      code?: string;
      retryAfterSeconds?: number;
      transcript?: string;
      result?: IntentResult;
      timing?: unknown;
    };
    responseParseMs = Date.now() - responseStartedAt;
    if (!response.ok) {
      throw voiceHttpError({
        message: payload.error,
        code: payload.code,
        retryAfterSeconds: payload.retryAfterSeconds,
      });
    }
    if (!payload.transcript || !payload.result)
      throw new Error(
        "LeadLoop received an invalid voice response. Please try again.",
      );
    const timing: MobileVoiceClientTiming = {
      sessionMs,
      requestSetupMs,
      requestRoundTripMs,
      responseParseMs,
      totalMs: Date.now() - startedAt,
      audioBytes,
      ...(validServerTiming(payload.timing) ? { server: payload.timing } : {}),
    };
    input.onTiming?.(timing);
    emittedTiming = true;
    return { transcript: payload.transcript, result: payload.result, timing };
  } catch (error) {
    if (isVoiceTimeout(error)) throw voiceTimeoutError();
    throw error;
  } finally {
    clearTimeout(timer);
    if (!emittedTiming)
      input.onTiming?.({
        sessionMs,
        requestSetupMs,
        requestRoundTripMs,
        responseParseMs,
        totalMs: Date.now() - startedAt,
        audioBytes,
      });
  }
}
