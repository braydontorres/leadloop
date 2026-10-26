import type { SupabaseClient } from "@supabase/supabase-js";
import { File, Paths } from "expo-file-system";
import { fetch as expoFetch } from "expo/fetch";
import type { AssistantSpeed, AssistantVoiceId } from "./assistant-preferences";
import {
  naturalSpeechResponseMatchesSelection,
  type NaturalSpeechRequestStage,
} from "./natural-speech-response";
import {
  activeNaturalSpeechCooldown,
  setNaturalSpeechCooldown,
  type NaturalSpeechRequestKind,
} from "./natural-speech-cooldown";
import { mobileVoiceJsonHeaders } from "./voice-auth";
import { mobileVoiceConfig } from "./config";
import {
  currentMobileVoiceAccessToken,
  MobileVoiceSessionError,
} from "./voice-session";
import { MobileVoiceApiError } from "./voice-response";

const REQUEST_TIMEOUT_MS = 25_000;
const MAX_AUDIO_BYTES = 2 * 1024 * 1024;

export type NaturalSpeechStage = NaturalSpeechRequestStage;

export class NaturalSpeechApiError extends MobileVoiceApiError {
  constructor(
    message: string,
    code: string | undefined,
    public readonly stage: NaturalSpeechStage,
    public readonly retryAfterSeconds?: number,
  ) {
    super(message, code);
    this.name = "NaturalSpeechApiError";
  }
}

export type NaturalSpeechResponse = {
  file: File;
  source: "openai-tts";
  voice: AssistantVoiceId;
  speed: AssistantSpeed;
  timing: {
    sessionMs: number;
    requestRoundTripMs: number;
    downloadMs: number;
    cacheMs: number;
    totalMs: number;
  };
};

function naturalSpeechConfig() {
  try {
    return mobileVoiceConfig(process.env);
  } catch {
    throw speechError(
      "Natural voices need a valid secure LeadLoop API address. Device speech is still available.",
      "SPEECH_API_URL_INVALID",
      "configuration",
    );
  }
}

/**
 * The server marks successful generated audio with its selected, non-secret
 * voice metadata. A mismatch means the app must not label a fallback or stale
 * response as the requested Natural AI preview.
 */
function speechError(
  message: string,
  code: string | undefined,
  stage: NaturalSpeechStage,
  retryAfterSeconds?: number,
) {
  return new NaturalSpeechApiError(
    message || "LeadLoop could not create a natural voice response.",
    code,
    stage,
    retryAfterSeconds,
  );
}

/** Fetches a short private MP3 and keeps it only in the app cache for playback. */
export async function requestNaturalSpeech(input: {
  client: SupabaseClient;
  workspaceId: string;
  text: string;
  voice: AssistantVoiceId;
  speed: AssistantSpeed;
  kind: NaturalSpeechRequestKind;
}): Promise<NaturalSpeechResponse> {
  const config = naturalSpeechConfig();
  if (!config)
    throw speechError(
      "Natural voices need the secure LeadLoop API address. Device speech is still available.",
      "SPEECH_NOT_CONFIGURED",
      "configuration",
    );
  const cooldown = activeNaturalSpeechCooldown({
    workspaceId: input.workspaceId,
    kind: input.kind,
  });
  if (cooldown)
    throw speechError(
      "Natural voice is cooling down. Device speech is still available.",
      "LOCAL_RATE_LIMIT",
      "response",
      cooldown,
    );
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const startedAt = Date.now();
  let sessionMs = 0;
  let requestRoundTripMs = 0;
  let downloadMs = 0;
  let cacheMs = 0;
  try {
    const sessionStartedAt = Date.now();
    const accessToken = await currentMobileVoiceAccessToken(input.client);
    sessionMs = Date.now() - sessionStartedAt;
    let headers: Headers;
    let body: string;
    try {
      headers = mobileVoiceJsonHeaders(accessToken);
      body = JSON.stringify({
        workspaceId: input.workspaceId,
        text: input.text,
        voice: input.voice,
        speed: input.speed,
        kind: input.kind,
      });
    } catch {
      throw speechError(
        "LeadLoop could not prepare the natural voice request. Device speech is still available.",
        "SPEECH_REQUEST_CREATE_FAILED",
        "request",
      );
    }
    const requestStartedAt = Date.now();
    const response = await expoFetch(`${config.apiBaseUrl}/api/mobile/speech`, {
      method: "POST",
      headers,
      body,
      signal: controller.signal,
    });
    requestRoundTripMs = Date.now() - requestStartedAt;
    if (!response.ok) {
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        code?: string;
        retryAfterSeconds?: number;
      };
      const retryAfterHeader = Number(response.headers.get("retry-after"));
      const retryAfterSeconds =
        Number.isSafeInteger(payload.retryAfterSeconds) &&
        payload.retryAfterSeconds &&
        payload.retryAfterSeconds > 0
          ? payload.retryAfterSeconds
          : Number.isSafeInteger(retryAfterHeader) && retryAfterHeader > 0
            ? retryAfterHeader
            : undefined;
      if (response.status === 429)
        setNaturalSpeechCooldown({
          workspaceId: input.workspaceId,
          kind: input.kind,
          retryAfterSeconds,
        });
      throw speechError(
        payload.error ?? "",
        payload.code ?? `SPEECH_HTTP_${response.status}`,
        "response",
        retryAfterSeconds,
      );
    }
    const contentType = response.headers.get("content-type")?.toLowerCase();
    if (!contentType?.startsWith("audio/mpeg"))
      throw speechError(
        "LeadLoop received an invalid natural voice response. Device speech is still available.",
        "SPEECH_RESPONSE_INVALID",
        "response",
      );
    if (!naturalSpeechResponseMatchesSelection(response.headers, input))
      throw speechError(
        "LeadLoop could not verify the selected natural voice response. Device speech is still available.",
        "SPEECH_RESPONSE_MISMATCH",
        "response",
      );
    let bytes: Uint8Array;
    try {
      const downloadStartedAt = Date.now();
      bytes = new Uint8Array(await response.arrayBuffer());
      downloadMs = Date.now() - downloadStartedAt;
    } catch {
      throw speechError(
        "LeadLoop could not download the natural voice audio. Device speech is still available.",
        "SPEECH_DOWNLOAD_FAILED",
        "download",
      );
    }
    if (!bytes.byteLength || bytes.byteLength > MAX_AUDIO_BYTES)
      throw speechError(
        "LeadLoop received an unusable natural voice response. Device speech is still available.",
        "SPEECH_RESPONSE_INVALID",
        "response",
      );
    try {
      const cacheStartedAt = Date.now();
      const file = new File(
        Paths.cache,
        `leadloop-assistant-${Date.now()}-${Math.random().toString(36).slice(2)}.mp3`,
      );
      file.create({ overwrite: true, intermediates: true });
      file.write(bytes);
      cacheMs = Date.now() - cacheStartedAt;
      return {
        file,
        source: "openai-tts",
        voice: input.voice,
        speed: input.speed,
        timing: {
          sessionMs,
          requestRoundTripMs,
          downloadMs,
          cacheMs,
          totalMs: Date.now() - startedAt,
        },
      };
    } catch {
      throw speechError(
        "LeadLoop could not prepare the natural voice audio. Device speech is still available.",
        "SPEECH_CACHE_WRITE_FAILED",
        "cache",
      );
    }
  } catch (error) {
    if (error instanceof MobileVoiceApiError) throw error;
    if (error instanceof MobileVoiceSessionError)
      throw speechError(error.message, error.code, "session");
    if ((error as { name?: unknown })?.name === "AbortError")
      throw speechError(
        "Natural voice playback timed out. Device speech is still available.",
        "SPEECH_TIMEOUT",
        "transport",
      );
    if (error instanceof TypeError)
      throw speechError(
        "LeadLoop could not reach the natural voice service. Device speech is still available.",
        "SPEECH_NETWORK_ERROR",
        "transport",
      );
    throw speechError(
      "LeadLoop could not create the natural voice request. Device speech is still available.",
      "SPEECH_REQUEST_FAILED",
      "request",
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
