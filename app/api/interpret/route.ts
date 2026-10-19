import { NextResponse } from "next/server";
import {
  ApiError,
  interpretThought,
  validateInterpretationInput,
} from "../../../lib/ai-server";
import {
  clientId,
  limitRequest,
  releaseRequest,
  type RequestPermit,
} from "../../../lib/request-limit";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let permit: RequestPermit | undefined;
  const startedAt = performance.now();
  try {
    const input = validateInterpretationInput(await request.json());
    permit = limitRequest(clientId(request.headers));
    const result = await interpretThought(
      input.text,
      input.timeZone,
      input.context,
    );
    console.info(
      "[LeadLoop interpretation timing]",
      JSON.stringify({ totalMs: Math.round(performance.now() - startedAt) }),
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
    if (permit && known.code !== "LOCAL_RATE_LIMIT") releaseRequest(permit);
    if (known.status === 429)
      console.error(
        "[LeadLoop interpretation]",
        JSON.stringify({
          errorType: known.code,
          httpStatus: known.status,
          rateLimitSource: known.source,
          retryAfterSeconds: known.retryAfterSeconds,
          requestId: known.requestId,
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
        rateLimitSource: known.status === 429 ? known.source : undefined,
        demoMode: known.code === "AI_NOT_CONFIGURED",
      },
      { status: known.status, headers },
    );
  }
}
