/**
 * Keeps voice authorization a Fetch-standard header even when the request body
 * is an Expo File-backed multipart FormData instance. The value is never logged
 * or included in device diagnostics.
 */
export function mobileVoiceAuthorizationHeaders(accessToken: string) {
  return new Headers({ Authorization: `Bearer ${accessToken}` });
}
