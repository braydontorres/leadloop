import type { ConversationContext, IntentResult } from "./conversation-machine";

const noFields = {
  title: null,
  person: null,
  date: null,
  time: null,
  notes: null,
  clearDue: false,
} as const;

/**
 * A deliberately narrow, deterministic shortcut for a completed read-back.
 * Audio still goes through transcription; this only avoids a second AI call
 * when the resulting text can mean exactly one thing in the current state.
 */
export function standaloneVoiceConfirmation(
  transcript: string,
  context: ConversationContext,
): IntentResult | null {
  if (context.stage !== "awaiting_confirmation" || !context.activeReminder)
    return null;
  const answer = transcript
    .trim()
    .toLowerCase()
    .replace(/[.!?,;:]+$/g, "")
    .replace(/\s+/g, " ");
  if (
    [
      "yes",
      "yes please",
      "correct",
      "that's right",
      "that is right",
      "that's correct",
      "confirm",
    ].includes(answer)
  )
    return { intent: { kind: "confirm", fields: { ...noFields } } };
  if (
    ["no", "not right", "that's not right", "that is not right"].includes(
      answer,
    )
  )
    return { intent: { kind: "reject", fields: { ...noFields } } };
  return null;
}
