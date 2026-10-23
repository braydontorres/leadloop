import { NextResponse } from "next/server";
import {
  ApiError,
  isNaturalSpeechSpeed,
  isNaturalSpeechVoice,
  synthesizeNaturalSpeech,
} from "../../../../lib/ai-server";
import { authorizeMobileVoice } from "../../../../lib/mobile-voice-auth";
import {
  limitRequest,
  mobileSpeechLimitKey,
  mobileSpeechRateLimitConfig,
  releaseRequest,
  type MobileSpeechRequestKind,
  type RequestPermit,
} from "../../../../lib/request-limit";

export const runtime = "nodejs";

const WORKSPACE_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_ASSISTANT_REPLY_CHARACTERS = 600;
const MAX_PREVIEW_CHARACTERS = 240;

function requestInput(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new ApiError("Send a valid speech request.", 400, "INVALID_REQUEST");
  const input = value as Record<string, unknown>;
  const workspaceId = input.workspaceId;
  const text = input.text;
  // Older mobile bundles did not identify previews. Keep them working as an
  // assistant reply while new bundles receive a separate preview budget.
  const kind: MobileSpeechRequestKind =
    input.kind === "preview" ? "preview" : "assistant_reply";
  if (typeof workspaceId !== "string" || !WORKSPACE_ID.test(workspaceId))
    throw new ApiError(
      "Choose a valid cloud workspace before playing a natural voice.",
      400,
      "WORKSPACE_INVALID",
    );
  const maximumCharacters =
    kind === "preview"
      ? MAX_PREVIEW_CHARACTERS
      : MAX_ASSISTANT_REPLY_CHARACTERS;
  if (
    typeof text !== "string" ||
    !text.trim() ||
    text.length > maximumCharacters
  )
    throw new ApiError(
      `LeadLoop can speak ${kind === "preview" ? "voice previews" : "replies"} up to ${maximumCharacters} characters.`,
      400,
      "SPEECH_TEXT_INVALID",
    );
  if (!isNaturalSpeechVoice(input.voice))
    throw new ApiError(
      "Choose a supported voice.",
      400,
      "SPEECH_VOICE_INVALID",
    );
  if (!isNaturalSpeechSpeed(input.speed))
    throw new ApiError(
      "Choose a supported speaking speed.",
      400,
      "SPEECH_SPEED_INVALID",
    );
  return {
    workspaceId,
    text: text.trim(),
    voice: input.voice,
    speed: input.speed,
    kind,
  };
}

/**
 * Returns short-lived synthesized audio only after JWT and workspace-membership
 * checks. The server does not persist text or generated audio.
 */
export async function POST(request: Request) {
  let permit: RequestPermit | undefined;
  const startedAt = performance.now();
  try {
    const input = requestInput(await request.json());
    const user = await authorizeMobileVoice(request, input.workspaceId);
    permit = limitRequest(
      mobileSpeechLimitKey(user.id, input.kind),
      undefined,
      mobileSpeechRateLimitConfig(input.kind),
    );
    const response = await synthesizeNaturalSpeech(input);
    const audio = await response.arrayBuffer();
    if (!audio.byteLength)
      throw new ApiError(
        "LeadLoop received an empty voice response. Try device speech instead.",
        502,
        "AI_SPEECH_EMPTY",
      );
    console.info(
      "[LeadLoop mobile speech]",
      JSON.stringify({
        operation: "complete",
        kind: input.kind,
        characterCount: input.text.length,
        totalMs: Math.round(performance.now() - startedAt),
      }),
    );
    return new NextResponse(audio, {
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "no-store, private",
        "Content-Length": String(audio.byteLength),
        // These non-secret response markers let a native client verify that
        // it received the exact requested generated audio instead of quietly
        // falling back to device speech.
        "X-LeadLoop-Speech-Source": "openai-tts",
        "X-LeadLoop-Speech-Voice": input.voice,
        "X-LeadLoop-Speech-Speed": input.speed,
      },
    });
  } catch (error) {
    const known =
      error instanceof ApiError
        ? error
        : new ApiError(
            "LeadLoop could not create a natural voice response. Try device speech instead.",
            500,
            "SPEECH_UNEXPECTED_ERROR",
          );
    if (permit && known.code !== "LOCAL_RATE_LIMIT") releaseRequest(permit);
    console.error(
      "[LeadLoop mobile speech]",
      JSON.stringify({
        errorType: known.code,
        httpStatus: known.status,
        requestId: known.requestId,
        rateLimitSource: known.status === 429 ? known.source : undefined,
        totalMs: Math.round(performance.now() - startedAt),
      }),
    );
    const headers = new Headers({ "Cache-Control": "no-store, private" });
    if (known.retryAfterSeconds)
      headers.set("Retry-After", String(known.retryAfterSeconds));
    return NextResponse.json(
      {
        error: known.message,
        code: known.code,
        retryAfterSeconds: known.retryAfterSeconds,
      },
      { status: known.status, headers },
    );
  }
}
