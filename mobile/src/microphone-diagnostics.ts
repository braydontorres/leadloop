export type MicrophoneStage =
  | "permission"
  | "audio_session"
  | "prepare"
  | "start"
  | "meter_startup"
  | "meter_recovery"
  | "status"
  | "stop"
  | "file";

export type MicrophoneDiagnostic = {
  stage: MicrophoneStage;
  category: "permission" | "audio_session" | "recorder" | "file";
  outcome: "failed" | "succeeded";
  detail?: string;
};

export function microphoneFailure(
  stage: MicrophoneStage,
  detail?: string,
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
    ...(detail ? { detail } : {}),
  };
}

export function microphoneSuccess(
  stage: MicrophoneStage,
  detail?: string,
): MicrophoneDiagnostic {
  return {
    ...microphoneFailure(stage, detail),
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
    case "meter_startup":
      return "LeadLoop could not receive a live iPhone microphone level. Resume listening or use Record one turn.";
    case "meter_recovery":
      return "LeadLoop could not refresh the iPhone microphone. Resume listening or use Record one turn.";
    case "status":
      return "The iPhone recorder was interrupted or reloaded. Resume listening or record one turn again.";
    case "stop":
      return "LeadLoop could not finish that recording. Your reminder was not changed; try again.";
    case "file":
      return "LeadLoop did not receive a usable audio file. Try recording a little longer.";
  }
}
