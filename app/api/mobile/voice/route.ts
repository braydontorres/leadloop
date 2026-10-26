import { NextResponse } from "next/server";
import {
  ApiError,
  interpretThought,
  transcribeAudio,
  validateInterpretationInput,
} from "../../../../lib/ai-server";
import { supportedUploadedAudioFormat } from "../../../../lib/audio-format";
import {
  authorizeMobileVoice,
  mobileVoiceAuthDiagnostic,
} from "../../../../lib/mobile-voice-auth";
import {
  limitRequest,
  releaseRequest,
  type RequestPermit,
} from "../../../../lib/request-limit";
import { standaloneVoiceConfirmation } from "../../../../lib/voice-confirmation";

export const runtime = "nodejs";
const MAX_AUDIO_BYTES = 10 * 1024 * 1024;
const MAX_DURATION_MS = 90_000;
const WORKSPACE_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function numericDuration(value: FormDataEntryValue | null) {
  const duration = typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isFinite(duration) || duration < 0 || duration > MAX_DURATION_MS)
    throw new ApiError(
      "Record a voice note shorter than 90 seconds.",
      400,
      "AUDIO_DURATION_INVALID",
    );
  return Math.round(duration);
}

export async function POST(request: Request) {
  let permit: RequestPermit | undefined;
  const startedAt = performance.now();
  let operation:
    | "form_data"
    | "authorization"
    | "validation"
    | "transcription"
    | "interpretation" = "form_data";
  let formDataMs = 0;
  let authorizationMs = 0;
  let validationMs = 0;
  let transcriptionMs = 0;
  let interpretationMs = 0;
  let audioBytes: number | null = null;
  let durationMs: number | null = null;
  try {
    const formStartedAt = performance.now();
    const form = await request.formData();
    formDataMs = Math.round(performance.now() - formStartedAt);
    const workspaceId = form.get("workspaceId");
    if (typeof workspaceId !== "string" || !WORKSPACE_ID.test(workspaceId))
      throw new ApiError(
        "Choose a valid cloud workspace before recording.",
        400,
        "WORKSPACE_INVALID",
      );
    operation = "authorization";
    const authorizationStartedAt = performance.now();
    const user = await authorizeMobileVoice(request, workspaceId);
    authorizationMs = Math.round(performance.now() - authorizationStartedAt);
    operation = "validation";
    const validationStartedAt = performance.now();
    const audio = form.get("audio");
    if (!(audio instanceof File) || audio.size === 0)
      throw new ApiError(
        "Record a short voice note before sending it.",
        400,
        "EMPTY_AUDIO",
      );
    if (audio.size > MAX_AUDIO_BYTES)
      throw new ApiError(
        "That recording is too large. Keep voice notes under 90 seconds.",
        413,
        "AUDIO_TOO_LARGE",
      );
    if (!(await supportedUploadedAudioFormat(audio)))
      throw new ApiError(
        "This iPhone recorded an unsupported audio format. Try typing instead.",
        415,
        "AUDIO_UNSUPPORTED",
      );
    durationMs = numericDuration(form.get("durationMs"));
    audioBytes = audio.size;
    const rawContext = form.get("context");
    const context =
      typeof rawContext === "string" ? JSON.parse(rawContext) : {};
    const valid = validateInterpretationInput({
      text: "voice note",
      timeZone: form.get("timeZone"),
      context,
    });
    validationMs = Math.round(performance.now() - validationStartedAt);
    permit = limitRequest(`mobile:${user.id}`);
    operation = "transcription";
    const transcriptionStarted = performance.now();
    const transcript = await transcribeAudio(audio);
    transcriptionMs = Math.round(performance.now() - transcriptionStarted);
    operation = "interpretation";
    const interpretationStarted = performance.now();
    const confirmation = standaloneVoiceConfirmation(transcript, valid.context);
    const result =
      confirmation ??
      (await interpretThought(transcript, valid.timeZone, valid.context));
    interpretationMs = Math.round(performance.now() - interpretationStarted);
    const interpretationSource = confirmation
      ? "confirmation_fast_path"
      : "openai";
    const timing = {
      formDataMs,
      authorizationMs,
      validationMs,
      transcriptionMs,
      interpretationMs,
      interpretationSource,
      audioBytes,
      durationMs,
      totalMs: Math.round(performance.now() - startedAt),
    };
    console.info(
      "[LeadLoop mobile voice]",
      JSON.stringify({
        operation: "complete",
        contextStage: valid.context.stage,
        ...timing,
      }),
    );
    return NextResponse.json({ transcript, result, timing });
  } catch (error) {
    const known =
      error instanceof ApiError
        ? error
        : new ApiError(
            "LeadLoop couldn't process that recording. Please try again.",
            500,
            "UNEXPECTED_ERROR",
          );
    if (permit && known.code !== "LOCAL_RATE_LIMIT") releaseRequest(permit);
    console.error(
      "[LeadLoop mobile voice]",
      JSON.stringify({
        errorType: known.code,
        httpStatus: known.status,
        requestId: known.requestId,
        rateLimitSource: known.status === 429 ? known.source : undefined,
        retryAfterSeconds: known.retryAfterSeconds,
        authVerification: mobileVoiceAuthDiagnostic(known),
        operation,
        formDataMs,
        authorizationMs,
        validationMs,
        transcriptionMs,
        interpretationMs,
        audioBytes,
        durationMs,
        totalMs: Math.round(performance.now() - startedAt),
      }),
    );
    const headers = new Headers();
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
