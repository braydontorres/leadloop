import type { ConversationStage } from "../../lib/conversation-machine";

/** Guards async callbacks so an ended/restarted foreground session stays ended. */
export function canResumeHandsFreeListening(input: {
  active: boolean;
  callbackSessionId: number;
  currentSessionId: number;
  nextStage: ConversationStage;
}) {
  return (
    input.active &&
    input.callbackSessionId === input.currentSessionId &&
    input.nextStage !== "ended"
  );
}

/** One recording turn may be stopped/submitted by only one competing callback. */
export function canFinalizeHandsFreeTurn(
  turn: number,
  alreadyFinalizedTurn: number | null,
) {
  return alreadyFinalizedTurn !== turn;
}
