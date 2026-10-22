import type { VoiceActivityAction } from "./hands-free-vad";

/** The small status subset needed by the foreground hands-free recorder loop. */
export type NativeRecorderStatus = {
  isRecording: boolean;
  durationMillis: number;
  metering?: number;
  nativeError?: "recorder_invalidated" | null;
};

export type HandsFreeRecorderStatus = {
  active: boolean;
  durationMillis: number;
  meterDb: number | undefined;
  checkedAtMs: number | null;
  wallElapsedMs: number;
  nativeError: "recorder_invalidated" | null;
  action:
    | VoiceActivityAction
    | "waiting"
    | "recorder_inactive"
    | "recorder_invalidated";
};

export const initialHandsFreeRecorderStatus: HandsFreeRecorderStatus = {
  active: false,
  durationMillis: 0,
  meterDb: undefined,
  checkedAtMs: null,
  wallElapsedMs: 0,
  nativeError: null,
  action: "waiting",
};

export function recorderStatusSnapshot(
  status: NativeRecorderStatus,
  checkedAtMs: number,
  action: HandsFreeRecorderStatus["action"] = "waiting",
  wallElapsedMs = 0,
): HandsFreeRecorderStatus {
  return {
    active: status.isRecording,
    durationMillis: status.durationMillis,
    meterDb: status.metering,
    checkedAtMs,
    wallElapsedMs,
    nativeError: status.nativeError ?? null,
    action,
  };
}

/** A status read after a turn starts is authoritative about recorder loss. */
export function recorderStoppedUnexpectedly(status: HandsFreeRecorderStatus) {
  return status.checkedAtMs !== null && !status.active;
}
