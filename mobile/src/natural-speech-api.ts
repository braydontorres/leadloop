import type { SupabaseClient } from "@supabase/supabase-js";
import { File, Paths } from "expo-file-system";
import { fetch as expoFetch } from "expo/fetch";
import type { AssistantSpeed, AssistantVoiceId } from "./assistant-preferences";
import { mobileVoiceAuthorizationHeaders } from "./voice-auth";
import { mobileVoiceConfig } from "./config";
import { currentMobileVoiceAccessToken } from "./voice-session";
import { MobileVoiceApiError } from "./voice-response";

const config = mobileVoiceConfig(process.env);
const REQUEST_TIMEOUT_MS = 25_000;
const MAX_AUDIO_BYTES = 2 * 1024 * 1024;

function speechError(message: string, code?: string) {
  return new MobileVoiceApiError(
    message || "LeadLoop could not create a natural voice response.",
    code,
  );
}

/** Fetches a short private MP3 and keeps it only in the app cache for playback. */
export async function requestNaturalSpeech(input: {
  client: SupabaseClient;
  workspaceId: string;
  text: string;
  voice: AssistantVoiceId;
  speed: AssistantSpeed;
}): Promise<File> {
  if (!config)
    throw speechError(
      "Natural voices need the secure LeadLoop API address. Device speech is still available.",
      "SPEECH_NOT_CONFIGURED",
    );
  const accessToken = await currentMobileVoiceAccessToken(input.client);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await expoFetch(`${config.apiBaseUrl}/api/mobile/speech`, {
      method: "POST",
      headers: {
        ...mobileVoiceAuthorizationHeaders(accessToken),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        workspaceId: input.workspaceId,
        text: input.text,
        voice: input.voice,
        speed: input.speed,
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        code?: string;
      };
      throw speechError(payload.error ?? "", payload.code);
    }
    const contentType = response.headers.get("content-type")?.toLowerCase();
    if (!contentType?.startsWith("audio/mpeg"))
      throw speechError(
        "LeadLoop received an invalid natural voice response. Device speech is still available.",
        "SPEECH_RESPONSE_INVALID",
      );
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!bytes.byteLength || bytes.byteLength > MAX_AUDIO_BYTES)
      throw speechError(
        "LeadLoop received an unusable natural voice response. Device speech is still available.",
        "SPEECH_RESPONSE_INVALID",
      );
    const file = new File(
      Paths.cache,
      `leadloop-assistant-${Date.now()}-${Math.random().toString(36).slice(2)}.mp3`,
    );
    file.create({ overwrite: true, intermediates: true });
    file.write(bytes);
    return file;
  } catch (error) {
    if (error instanceof MobileVoiceApiError) throw error;
    if ((error as { name?: unknown })?.name === "AbortError")
      throw speechError(
        "Natural voice playback timed out. Device speech is still available.",
        "SPEECH_TIMEOUT",
      );
    throw speechError(
      "LeadLoop could not reach natural voice playback. Device speech is still available.",
      "SPEECH_NETWORK_ERROR",
    );
  } finally {
    clearTimeout(timeout);
  }
}

export function removeNaturalSpeechFile(file: File | null) {
  try {
    if (file?.exists) file.delete();
  } catch {
    // This is an OS-managed cache file; cleanup failure must not affect speech.
  }
}
