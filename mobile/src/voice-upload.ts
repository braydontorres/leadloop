/** The subset supplied by Expo FileSystem's native `File` object. */
export type ExpoAudioFilePart = {
  exists: boolean;
  size: number;
  name: string;
  type: string;
  bytes(): Promise<Uint8Array>;
};

export function appendExpoAudioFile(form: FormData, file: ExpoAudioFilePart) {
  if (!file.exists || file.size <= 0)
    throw new Error(
      "The recording audio file is unavailable. Please record again.",
    );
  // `expo/fetch` serializes Expo FileSystem File objects through `bytes()`.
  // Reject React Native's former { uri, name, type } transport shape here so
  // it cannot regress to an unsupported multipart part.
  if (typeof file.bytes !== "function")
    throw new Error(
      "The recording cannot be uploaded by this version of LeadLoop.",
    );
  form.append("audio", file as unknown as Blob, "leadloop-voice-turn.m4a");
}
