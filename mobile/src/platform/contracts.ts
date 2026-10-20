/** Platform adapters keep experimental native APIs outside shared business rules. */
export type CapturedAudio = {
  uri: string;
  mimeType: string;
  durationMs: number;
};
export interface NativeMicrophone {
  requestPermission(): Promise<"granted" | "denied">;
  startTurn(): Promise<void>;
  stopTurn(): Promise<CapturedAudio | null>;
  cancelTurn(): Promise<void>;
}
export interface NativeSpeechPlayback {
  speak(text: string): Promise<void>;
  stop(): Promise<void>;
}
/** Siri/App Intents support is intentionally an adapter until the Expo integration stabilizes. */
export interface ShortcutIntentBridge {
  registerReminderCapture(): Promise<void>;
  unregisterAll(): Promise<void>;
}
export interface DeviceNotificationRegistration {
  registerToken(): Promise<string | null>;
  unregisterToken(): Promise<void>;
}
