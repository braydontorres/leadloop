export type CaptureDisplayState =
  | "ready"
  | "listening"
  | "user_speaking"
  | "processing"
  | "speaking"
  | "saving"
  | "error";

/** The Capture screen keeps one fixed-position circular control in every state. */
export function primaryConversationControl(
  conversationActive: boolean,
  _status: CaptureDisplayState,
) {
  return conversationActive
    ? {
        visible: true,
        label: "End Conversation",
        accessibilityLabel: "End voice conversation",
        icon: "■",
        tone: "danger" as const,
      }
    : {
        visible: true,
        label: "Start Conversation",
        accessibilityLabel: "Start voice conversation",
        icon: "●",
        tone: "start" as const,
      };
}
