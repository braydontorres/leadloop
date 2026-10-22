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
    // Expo's iOS high-quality recorder reports this common MPEG-4 alias.
    "audio/m4a": { extension: "m4a", label: "MPEG-4 audio" },
    "video/mp4": { extension: "m4a", label: "MPEG-4 audio" },
    "audio/ogg": { extension: "ogg", label: "Ogg audio" },
    "audio/mpeg": { extension: "mp3", label: "MPEG audio" },
    "audio/wav": { extension: "wav", label: "WAV audio" },
    "audio/x-wav": { extension: "wav", label: "WAV audio" },
  };

const GENERIC_UPLOAD_MIME_TYPES = new Set([
  "",
  "application/octet-stream",
  "application/x-octet-stream",
  "binary/octet-stream",
]);

const MPEG4_AUDIO_BRANDS = new Set(["M4A ", "M4B ", "M4P ", "M4R "]);

export function normalizeAudioMimeType(mimeType: string) {
  return mimeType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
}

export function supportedAudioFormat(mimeType: string) {
  return SUPPORTED_FORMATS[normalizeAudioMimeType(mimeType)] ?? null;
}

function ascii(bytes: Uint8Array, offset: number, length: number) {
  return String.fromCharCode(...bytes.slice(offset, offset + length));
}

/**
 * Expo's native File can report a generic MIME type for an iOS `.m4a`
 * recording. We accept that narrow case only after checking both its filename
 * and the ISO Base Media File Format `ftyp` audio brand. A filename alone is
 * never sufficient to accept a generic multipart upload.
 */
export async function supportedUploadedAudioFormat(
  audio: Pick<File, "type" | "name" | "slice">,
) {
  const declared = supportedAudioFormat(audio.type);
  if (declared) return declared;

  if (
    !GENERIC_UPLOAD_MIME_TYPES.has(normalizeAudioMimeType(audio.type)) ||
    !/\.m4a$/i.test(audio.name)
  )
    return null;

  const header = new Uint8Array(await audio.slice(0, 16).arrayBuffer());
  if (
    header.length < 12 ||
    ascii(header, 4, 4) !== "ftyp" ||
    !MPEG4_AUDIO_BRANDS.has(ascii(header, 8, 4))
  )
    return null;
  return SUPPORTED_FORMATS["audio/mp4"];
}

export function selectRecorderMimeType(
  isTypeSupported: (mimeType: string) => boolean,
) {
  return (
    RECORDER_MIME_CANDIDATES.find((mimeType) => isTypeSupported(mimeType)) ??
    null
  );
}
