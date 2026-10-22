export type MicrophoneStage =
  | "permission"
  | "audio_session"
  | "prepare"
  | "start"
  | "status"
  | "stop"
  | "file";

export type MicrophoneDiagnostic = {
  stage: MicrophoneStage;
  category: "permission" | "audio_session" | "recorder" | "file";
  outcome: "failed" | "succeeded";
};

export function microphoneFailure(
  stage: MicrophoneStage,
): MicrophoneDiagnostic {
  return {
    stage,
    category:
      stage === "permission"
        ? "permission"
        : stage === "audio_session"
          ? "audio_session"
          : stage === "file"
            ? "file"
            : "recorder",
    outcome: "failed",
  };
}

export function microphoneSuccess(
  stage: MicrophoneStage,
): MicrophoneDiagnostic {
  return {
    ...microphoneFailure(stage),
    outcome: "succeeded",
  };
}

export function microphoneErrorMessage(stage: MicrophoneStage) {
  switch (stage) {
    case "permission":
      return "Microphone access is needed to record. Enable it for Expo Go in iPhone Settings, then try again.";
    case "audio_session":
      return "LeadLoop could not configure the iPhone audio session. Close other recording apps and try again.";
    case "prepare":
      return "LeadLoop could not prepare the microphone. Try again in a moment.";
    case "start":
      return "LeadLoop could not start recording. Try again.";
    case "status":
      return "The iPhone recorder was interrupted or reloaded. Resume listening or record one turn again.";
    case "stop":
      return "LeadLoop could not finish that recording. Your reminder was not changed; try again.";
    case "file":
      return "LeadLoop did not receive a usable audio file. Try recording a little longer.";
  }
}
