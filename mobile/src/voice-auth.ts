/**
 * Keeps voice authorization a Fetch-standard header even when the request body
 * is an Expo File-backed multipart FormData instance. The value is never logged
 * or included in device diagnostics.
 */
export function mobileVoiceAuthorizationHeaders(accessToken: string) {
  return new Headers({ Authorization: `Bearer ${accessToken}` });
}

/**
 * `Headers` is deliberately kept as a Headers instance. Object-spreading one
 * on React Native can omit its internal Authorization entries before Expo
 * fetch serializes the request.
 */
export function mobileVoiceJsonHeaders(accessToken: string) {
  const headers = mobileVoiceAuthorizationHeaders(accessToken);
  headers.set("Content-Type", "application/json");
  return headers;
}
