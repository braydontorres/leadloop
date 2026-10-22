import AsyncStorage from "@react-native-async-storage/async-storage";

export const NATURAL_VOICE_OPTIONS = [
  { id: "alloy", label: "Alloy", description: "Balanced and clear" },
  { id: "echo", label: "Echo", description: "Warm, lower delivery" },
  { id: "fable", label: "Fable", description: "Expressive and steady" },
  { id: "onyx", label: "Onyx", description: "Calm, deeper delivery" },
  { id: "nova", label: "Nova", description: "Bright and friendly" },
  { id: "shimmer", label: "Shimmer", description: "Gentle and upbeat" },
] as const;

export const ASSISTANT_SPEEDS = ["relaxed", "normal", "fast"] as const;
export type AssistantSpeed = (typeof ASSISTANT_SPEEDS)[number];
export type AssistantVoiceId = (typeof NATURAL_VOICE_OPTIONS)[number]["id"];
export type AssistantSpeechMode = "device" | "natural";

export type AssistantPreferences = {
  mode: AssistantSpeechMode;
  voice: AssistantVoiceId;
  speed: AssistantSpeed;
  muted: boolean;
};

export const DEFAULT_ASSISTANT_PREFERENCES: AssistantPreferences = {
  // Cloud generation can incur API charges, so every new device starts with
  // the included device voice until its owner explicitly opts in.
  mode: "device",
  voice: "alloy",
  speed: "normal",
  muted: false,
};

export function assistantPreferencesKey(userId: string, workspaceId: string) {
  return `leadloop.assistant-speech.v1.${userId}.${workspaceId}`;
}

function isVoice(value: unknown): value is AssistantVoiceId {
  return NATURAL_VOICE_OPTIONS.some((option) => option.id === value);
}

function isSpeed(value: unknown): value is AssistantSpeed {
  return (ASSISTANT_SPEEDS as readonly string[]).includes(value as string);
}

export function normalizeAssistantPreferences(
  value: unknown,
): AssistantPreferences {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return { ...DEFAULT_ASSISTANT_PREFERENCES };
  const input = value as Record<string, unknown>;
  return {
    mode: input.mode === "natural" ? "natural" : "device",
    voice: isVoice(input.voice)
      ? input.voice
      : DEFAULT_ASSISTANT_PREFERENCES.voice,
    speed: isSpeed(input.speed)
      ? input.speed
      : DEFAULT_ASSISTANT_PREFERENCES.speed,
    muted: input.muted === true,
  };
}

export async function loadAssistantPreferences(
  userId: string,
  workspaceId: string,
): Promise<AssistantPreferences> {
  const value = await AsyncStorage.getItem(
    assistantPreferencesKey(userId, workspaceId),
  );
  if (!value) return { ...DEFAULT_ASSISTANT_PREFERENCES };
  try {
    return normalizeAssistantPreferences(JSON.parse(value));
  } catch {
    return { ...DEFAULT_ASSISTANT_PREFERENCES };
  }
}

export async function saveAssistantPreferences(
  userId: string,
  workspaceId: string,
  preferences: AssistantPreferences,
) {
  await AsyncStorage.setItem(
    assistantPreferencesKey(userId, workspaceId),
    JSON.stringify(normalizeAssistantPreferences(preferences)),
  );
}

export function deviceSpeechRate(speed: AssistantSpeed) {
  return speed === "relaxed" ? 0.46 : speed === "fast" ? 0.62 : 0.54;
}
