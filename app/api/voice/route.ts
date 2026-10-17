import { NextResponse } from "next/server";
import {
  ApiError,
  interpretThought,
  transcribeAudio,
  validateInterpretationInput,
} from "../../../lib/ai-server";
import { clientId, limitRequest } from "../../../lib/request-limit";

export const runtime = "nodejs";
const MAX_AUDIO_BYTES = 10 * 1024 * 1024;
const ALLOWED_AUDIO = new Set([
  "audio/webm",
  "audio/mp4",
  "audio/mpeg",
  "audio/ogg",
  "audio/wav",
  "audio/x-wav",
]);

export async function POST(request: Request) {
  try {
    limitRequest(clientId(request.headers));
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
    if (!ALLOWED_AUDIO.has(audio.type))
      throw new ApiError(
        "This browser recorded an unsupported audio format. Try typing instead.",
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
    const transcript = await transcribeAudio(audio);
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
    return NextResponse.json(
      {
        error: known.message,
        code: known.code,
        demoMode: known.code === "AI_NOT_CONFIGURED",
      },
      { status: known.status },
    );
  }
}
