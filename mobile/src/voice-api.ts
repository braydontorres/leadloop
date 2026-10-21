import type { SupabaseClient } from "@supabase/supabase-js";
import type { IntentResult } from "../../lib/conversation-machine";
import { mobileVoiceConfig } from "./config";

const config = mobileVoiceConfig(process.env);
const REQUEST_TIMEOUT_MS = 35_000;

export type MobileVoiceResponse = { transcript: string; result: IntentResult };

export async function uploadMobileVoiceTurn(input: {
  client: SupabaseClient;
  workspaceId: string;
  audioUri: string;
  durationMs: number;
  timeZone: string;
  context: unknown;
}): Promise<MobileVoiceResponse> {
  if (!config)
    throw new Error(
      "Voice processing is not configured. Add EXPO_PUBLIC_LEADLOOP_VOICE_API_URL, or use the typed reminder form.",
    );
  const { data, error } = await input.client.auth.getSession();
  if (error || !data.session?.access_token)
    throw new Error(
      "Your sign-in session has expired. Sign in again before recording.",
    );
  const body = new FormData();
  body.append("workspaceId", input.workspaceId);
  body.append("timeZone", input.timeZone);
  body.append("durationMs", String(Math.max(0, Math.round(input.durationMs))));
  body.append("context", JSON.stringify(input.context));
  body.append("audio", {
    uri: input.audioUri,
    name: "leadloop-voice-turn.m4a",
    type: "audio/m4a",
  } as unknown as Blob);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${config.apiBaseUrl}/api/mobile/voice`, {
      method: "POST",
      headers: { Authorization: `Bearer ${data.session.access_token}` },
      body,
      signal: controller.signal,
    });
    const payload = (await response.json().catch(() => ({}))) as {
      error?: string;
      retryAfterSeconds?: number;
      transcript?: string;
      result?: IntentResult;
    };
    if (!response.ok) {
      const retry = payload.retryAfterSeconds
        ? ` Try again in ${payload.retryAfterSeconds} seconds.`
        : "";
      throw new Error(
        (payload.error || "LeadLoop could not process that recording.") + retry,
      );
    }
    if (!payload.transcript || !payload.result)
      throw new Error(
        "LeadLoop received an invalid voice response. Please try again.",
      );
    return { transcript: payload.transcript, result: payload.result };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError")
      throw new Error(
        "Voice processing timed out. Your reminder was not changed; try again.",
      );
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
