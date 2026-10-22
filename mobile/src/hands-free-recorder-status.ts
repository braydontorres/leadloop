import type { VoiceActivityAction } from "./hands-free-vad";

/** The small status subset needed by the foreground hands-free recorder loop. */
export type NativeRecorderStatus = {
  isRecording: boolean;
  durationMillis: number;
  metering?: number;
};

export type HandsFreeRecorderStatus = {
  active: boolean;
  durationMillis: number;
  meterDb: number | undefined;
  checkedAtMs: number | null;
  action: VoiceActivityAction | "waiting" | "recorder_inactive";
};

export const initialHandsFreeRecorderStatus: HandsFreeRecorderStatus = {
  active: false,
  durationMillis: 0,
  meterDb: undefined,
  checkedAtMs: null,
  action: "waiting",
};

export function recorderStatusSnapshot(
  status: NativeRecorderStatus,
  checkedAtMs: number,
  action: HandsFreeRecorderStatus["action"] = "waiting",
): HandsFreeRecorderStatus {
  return {
    active: status.isRecording,
    durationMillis: status.durationMillis,
    meterDb: status.metering,
    checkedAtMs,
    action,
  };
}

/** A status read after a turn starts is authoritative about recorder loss. */
export function recorderStoppedUnexpectedly(status: HandsFreeRecorderStatus) {
  return status.checkedAtMs !== null && !status.active;
}
