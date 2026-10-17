import { NextResponse } from "next/server";
import {
  ApiError,
  interpretThought,
  validateInterpretationInput,
} from "../../../lib/ai-server";
import { clientId, limitRequest } from "../../../lib/request-limit";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    limitRequest(clientId(request.headers));
    const input = validateInterpretationInput(await request.json());
    const result = await interpretThought(
      input.text,
      input.timeZone,
      input.context,
    );
    return NextResponse.json({ transcript: input.text, result });
  } catch (error) {
    const known =
      error instanceof ApiError
        ? error
        : new ApiError(
            "LeadLoop couldn't understand that thought. Please try again.",
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
