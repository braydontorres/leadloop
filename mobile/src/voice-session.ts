const REFRESH_MARGIN_SECONDS = 60;

type VoiceSession = { access_token: string; expires_at?: number };
type VoiceSessionResult = {
  data: { session: VoiceSession | null };
  error: unknown;
};

type VoiceSessionClient = {
  auth: {
    getSession(): Promise<VoiceSessionResult>;
    refreshSession(): Promise<VoiceSessionResult>;
  };
};

export class MobileVoiceSessionError extends Error {
  constructor(
    message: string,
    public readonly code:
      "MOBILE_SESSION_MISSING" | "MOBILE_SESSION_REFRESH_FAILED",
  ) {
    super(message);
    this.name = "MobileVoiceSessionError";
  }
}

function usableAccessToken(session: VoiceSession | null) {
  return session?.access_token || null;
}

/**
 * Returns a session token that is not expired or about to expire. This is a
 * client-side freshness check only; the API still verifies the resulting JWT
 * with Supabase Auth before accepting audio.
 */
export async function currentMobileVoiceAccessToken(
  client: VoiceSessionClient,
  nowSeconds = Math.floor(Date.now() / 1000),
) {
  const current = await client.auth.getSession();
  const session = current.data.session;
  if (current.error || !session?.access_token)
    throw new MobileVoiceSessionError(
      "Your sign-in session has expired. Sign in again before recording.",
      "MOBILE_SESSION_MISSING",
    );

  // React Native can resume with a session that was persisted while the app
  // was backgrounded. Refresh before sending a token that is expired, missing
  // an expiry, or about to expire during the voice request.
  if (
    typeof session.expires_at === "number" &&
    session.expires_at > nowSeconds + REFRESH_MARGIN_SECONDS
  )
    return session.access_token;

  const refreshed = await client.auth.refreshSession();
  const accessToken = usableAccessToken(refreshed.data.session);
  if (refreshed.error || !accessToken)
    throw new MobileVoiceSessionError(
      "LeadLoop could not refresh your sign-in session. Check your connection and try again.",
      "MOBILE_SESSION_REFRESH_FAILED",
    );
  return accessToken;
}
