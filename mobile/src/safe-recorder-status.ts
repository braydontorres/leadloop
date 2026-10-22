import { useEffect, useState } from "react";

export type NativeRecorderStatus = {
  isRecording: boolean;
  durationMillis: number;
  mediaServicesDidReset?: boolean;
  metering?: number;
  url: string | null;
};

export type RecorderStatusReader = {
  getStatus(): NativeRecorderStatus;
};

export type SafeRecorderStatus = NativeRecorderStatus & {
  checkedAtMs: number | null;
  nativeError: "recorder_invalidated" | null;
};

export const initialSafeRecorderStatus: SafeRecorderStatus = {
  isRecording: false,
  durationMillis: 0,
  mediaServicesDidReset: false,
  metering: undefined,
  url: null,
  checkedAtMs: null,
  nativeError: null,
};

/**
 * Expo shared objects can be released during Fast Refresh, unmount, or an iOS
 * media interruption. Native calls must be treated as fallible rather than
 * allowing an asynchronous timer to surface an uncaught exception.
 */
export function readRecorderStatus(
  recorder: RecorderStatusReader,
  checkedAtMs = Date.now(),
): SafeRecorderStatus {
  try {
    return {
      ...recorder.getStatus(),
      checkedAtMs,
      nativeError: null,
    };
  } catch {
    return {
      ...initialSafeRecorderStatus,
      checkedAtMs,
      nativeError: "recorder_invalidated",
    };
  }
}

export function shouldContinueRecorderStatusPolling(
  status: SafeRecorderStatus,
) {
  return status.nativeError === null;
}

/** The single guarded recorder-status poll used by manual and hands-free UI. */
export function useSafeRecorderStatus(
  recorder: RecorderStatusReader,
  intervalMs = 100,
) {
  const [status, setStatus] = useState<SafeRecorderStatus>(
    initialSafeRecorderStatus,
  );

  useEffect(() => {
    let active = true;
    let interval: ReturnType<typeof setInterval> | null = null;
    const poll = () => {
      const next = readRecorderStatus(recorder);
      if (active) setStatus(next);
      if (!shouldContinueRecorderStatusPolling(next) && interval !== null) {
        clearInterval(interval);
        interval = null;
      }
      return shouldContinueRecorderStatusPolling(next);
    };
    if (poll()) interval = setInterval(poll, intervalMs);
    return () => {
      active = false;
      if (interval !== null) clearInterval(interval);
    };
  }, [intervalMs, recorder]);

  return status;
}

export function readRecorderUri(recorder: { uri: string | null }) {
  try {
    return recorder.uri;
  } catch {
    return null;
  }
}
