import { NextResponse } from "next/server";
import {
  ApiError,
  interpretThought,
  transcribeAudio,
  validateInterpretationInput,
} from "../../../../lib/ai-server";
import { supportedAudioFormat } from "../../../../lib/audio-format";
import { authorizeMobileVoice } from "../../../../lib/mobile-voice-auth";
import {
  limitRequest,
  releaseRequest,
  type RequestPermit,
} from "../../../../lib/request-limit";

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
}

export async function POST(request: Request) {
  let permit: RequestPermit | undefined;
  const startedAt = performance.now();
  try {
    const form = await request.formData();
    const workspaceId = form.get("workspaceId");
    if (typeof workspaceId !== "string" || !WORKSPACE_ID.test(workspaceId))
      throw new ApiError(
        "Choose a valid cloud workspace before recording.",
        400,
        "WORKSPACE_INVALID",
      );
    const user = await authorizeMobileVoice(request, workspaceId);
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
    if (!supportedAudioFormat(audio.type))
      throw new ApiError(
        "This iPhone recorded an unsupported audio format. Try typing instead.",
        415,
        "AUDIO_UNSUPPORTED",
      );
    numericDuration(form.get("durationMs"));
    const rawContext = form.get("context");
    const context =
      typeof rawContext === "string" ? JSON.parse(rawContext) : {};
    const valid = validateInterpretationInput({
      text: "voice note",
      timeZone: form.get("timeZone"),
      context,
    });
    permit = limitRequest(`mobile:${user.id}`);
    const transcriptionStarted = performance.now();
    const transcript = await transcribeAudio(audio);
    const interpretationStarted = performance.now();
    const result = await interpretThought(
      transcript,
      valid.timeZone,
      valid.context,
    );
    console.info(
      "[LeadLoop mobile voice]",
      JSON.stringify({
        operation: "complete",
        contextStage: valid.context.stage,
        transcriptionMs: Math.round(
          interpretationStarted - transcriptionStarted,
        ),
        interpretationMs: Math.round(performance.now() - interpretationStarted),
        totalMs: Math.round(performance.now() - startedAt),
      }),
    );
    return NextResponse.json({ transcript, result });
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
