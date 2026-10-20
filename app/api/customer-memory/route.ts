import { NextResponse } from "next/server";
import { parseCustomerMemoryText } from "../../../lib/customer-memory";

export const runtime = "nodejs";

/**
 * Stateless, local-language classification endpoint. It accepts only the one
 * current utterance and never receives a customer list, notes, or profile data.
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { text?: unknown };
    if (
      typeof body.text !== "string" ||
      !body.text.trim() ||
      body.text.length > 3000
    )
      return NextResponse.json(
        { error: "Enter a customer request." },
        { status: 400 },
      );
    const operation = parseCustomerMemoryText(body.text.trim());
    return NextResponse.json({ handled: Boolean(operation), operation });
  } catch {
    return NextResponse.json(
      { error: "Send a valid request." },
      { status: 400 },
    );
  }
}
