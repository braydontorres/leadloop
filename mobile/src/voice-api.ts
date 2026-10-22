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
import { appendExpoAudioFile } from "./voice-upload";

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
  const audioFile = new File(input.audioUri);
  appendExpoAudioFile(body, audioFile);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    // Expo's fetch recognizes FileSystem File and generates the multipart
    // boundary itself. Do not set Content-Type manually.
    const response = await expoFetch(`${config.apiBaseUrl}/api/mobile/voice`, {
      method: "POST",
      headers: mobileVoiceAuthorizationHeaders(data.session.access_token),
      body,
      signal: controller.signal,
    });
    const payload = (await response.json().catch(() => ({}))) as {
      error?: string;
      code?: string;
      retryAfterSeconds?: number;
      transcript?: string;
      result?: IntentResult;
    };
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
    return { transcript: payload.transcript, result: payload.result };
  } catch (error) {
    if (isVoiceTimeout(error)) throw voiceTimeoutError();
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
