/** The subset supplied by Expo FileSystem's native `File` object. */
export type ExpoAudioFilePart = {
  exists: boolean;
  size: number;
  name: string;
  type: string;
  bytes(): Promise<Uint8Array>;
};

export const IOS_MPEG4_AUDIO_MIME_TYPE = "audio/mp4";

type ExpoMpeg4AudioPart = {
  name: string;
  type: typeof IOS_MPEG4_AUDIO_MIME_TYPE;
  bytes(): Promise<Uint8Array>;
};

/**
 * `RecordingPresets.HIGH_QUALITY` records AAC in an iOS MPEG-4/M4A container.
 * expo-file-system may describe that native File as application/octet-stream,
 * and expo/fetch faithfully emits that value in multipart. Preserve the File's
 * native bytes while supplying the recorder's known media type to FormData.
 */
export function mpeg4AudioMultipartPart(
  file: ExpoAudioFilePart,
): ExpoMpeg4AudioPart {
  return {
    name: "leadloop-voice-turn.m4a",
    type: IOS_MPEG4_AUDIO_MIME_TYPE,
    bytes: () => file.bytes(),
  };
}

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
  // expo/fetch accepts FileSystem's bytes-capable part. This is not React
  // Native's unsupported { uri, name, type } transport shape, and does not
  // convert the recording to base64.
  form.append("audio", mpeg4AudioMultipartPart(file) as unknown as Blob);
}
