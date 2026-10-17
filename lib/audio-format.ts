export const RECORDER_MIME_CANDIDATES = [
  "audio/webm;codecs=opus", // Chrome, Edge, and Firefox
  "audio/webm",
  "audio/mp4;codecs=mp4a.40.2", // Safari on macOS and iOS
  "audio/mp4",
  "audio/ogg;codecs=opus",
  "audio/ogg",
] as const;

const SUPPORTED_FORMATS: Record<string, { extension: string; label: string }> =
  {
    "audio/webm": { extension: "webm", label: "WebM audio" },
    "audio/mp4": { extension: "m4a", label: "MPEG-4 audio" },
    "video/mp4": { extension: "m4a", label: "MPEG-4 audio" },
    "audio/ogg": { extension: "ogg", label: "Ogg audio" },
    "audio/mpeg": { extension: "mp3", label: "MPEG audio" },
    "audio/wav": { extension: "wav", label: "WAV audio" },
    "audio/x-wav": { extension: "wav", label: "WAV audio" },
  };

export function normalizeAudioMimeType(mimeType: string) {
  return mimeType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
}

export function supportedAudioFormat(mimeType: string) {
  return SUPPORTED_FORMATS[normalizeAudioMimeType(mimeType)] ?? null;
}

export function selectRecorderMimeType(
  isTypeSupported: (mimeType: string) => boolean,
) {
  return (
    RECORDER_MIME_CANDIDATES.find((mimeType) => isTypeSupported(mimeType)) ??
    null
  );
}
