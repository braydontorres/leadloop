import { NextResponse } from "next/server";
import {
  ApiError,
  interpretThought,
  transcribeAudio,
  validateInterpretationInput,
} from "../../../lib/ai-server";
import { supportedAudioFormat } from "../../../lib/audio-format";
import {
  clientId,
  limitRequest,
  releaseRequest,
  type RequestPermit,
} from "../../../lib/request-limit";

export const runtime = "nodejs";
const MAX_AUDIO_BYTES = 10 * 1024 * 1024;

export async function POST(request: Request) {
  let permit: RequestPermit | undefined;
  try {
    const form = await request.formData();
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
        "This browser recorded an audio format LeadLoop cannot transcribe. Try a current version of Chrome or Safari, or type your thought instead.",
        415,
        "AUDIO_UNSUPPORTED",
      );
    const rawContext = form.get("context");
    const timeZone = form.get("timeZone");
    const context =
      typeof rawContext === "string" ? JSON.parse(rawContext) : {};
    const valid = validateInterpretationInput({
      text: "voice note",
      timeZone,
      context,
    });
    permit = limitRequest(clientId(request.headers));
    const transcript = await transcribeAudio(audio);
    console.info(
      "[LeadLoop voice]",
      JSON.stringify({
        operation: "transcription_complete",
        transcriptLength: transcript.length,
        contextStage: valid.context.stage,
        hasActiveReminder: Boolean(valid.context.activeReminder),
      }),
    );
    const result = await interpretThought(
      transcript,
      valid.timeZone,
      valid.context,
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
      "[LeadLoop voice]",
      JSON.stringify({
        errorType: known.code,
        httpStatus: known.status,
        requestId: known.requestId,
        rateLimitSource: known.status === 429 ? known.source : undefined,
        retryAfterSeconds: known.retryAfterSeconds,
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
        rateLimitSource: known.status === 429 ? known.source : undefined,
        demoMode: known.code === "AI_NOT_CONFIGURED",
      },
      { status: known.status, headers },
    );
  }
}
