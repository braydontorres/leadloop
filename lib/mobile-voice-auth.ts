import { createClient } from "@supabase/supabase-js";
import { ApiError } from "./ai-server";

type AuthenticatedMobileUser = { id: string };

type SupabaseAuthError = {
  status?: unknown;
};

function supabaseConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key)
    throw new ApiError(
      "LeadLoop cloud authentication is not configured on this server.",
      503,
      "MOBILE_AUTH_NOT_CONFIGURED",
    );
  return { url: url.replace(/\/$/, ""), key };
}

function bearerToken(request: Request) {
  const value = request.headers.get("authorization");
  if (!value)
    throw new ApiError(
      "LeadLoop did not receive a sign-in authorization. Reopen the app and try again.",
      401,
      "MOBILE_AUTH_HEADER_MISSING",
    );
  const match = /^Bearer\s+(.+)$/i.exec(value);
  if (!match || match[1].length > 8192)
    throw new ApiError(
      "LeadLoop received an invalid sign-in authorization. Sign in again before recording.",
      401,
      "MOBILE_AUTH_HEADER_MALFORMED",
    );
  return match[1];
}

function authFailureStatus(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const status = (error as SupabaseAuthError).status;
  return typeof status === "number" ? status : undefined;
}

function rejectedTokenError() {
  return new ApiError(
    "Your sign-in session was rejected. Sign out and sign in again before recording.",
    401,
    "MOBILE_AUTH_TOKEN_REJECTED",
  );
}

function authServiceError() {
  return new ApiError(
    "LeadLoop could not verify your sign-in right now. Check your connection and try again.",
    503,
    "MOBILE_AUTH_SERVICE_UNAVAILABLE",
  );
}

function isRejectedAuthStatus(status: number | undefined) {
  return status === 400 || status === 401 || status === 403;
}

/** Validates the caller with their JWT; this route never uses a service-role key. */
export async function authorizeMobileVoice(
  request: Request,
  workspaceId: string,
): Promise<AuthenticatedMobileUser> {
  const token = bearerToken(request);
  const { url, key } = supabaseConfig();
  const client = createClient(url, key, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  let verifiedUser: { id: string } | null = null;
  try {
    const { data, error } = await client.auth.getUser(token);
    if (data.user) verifiedUser = { id: data.user.id };
    else if (isRejectedAuthStatus(authFailureStatus(error)))
      throw rejectedTokenError();
    else if (error) throw authServiceError();
    else throw rejectedTokenError();
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (isRejectedAuthStatus(authFailureStatus(error)))
      throw rejectedTokenError();
    throw authServiceError();
  }
  // RLS evaluates this request as the authenticated caller. A member can only
  // prove membership in a workspace they are allowed to use.
  const membership = await client
    .from("workspace_members")
    .select("workspace_id")
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (membership.error || !membership.data)
    throw new ApiError(
      "You do not have access to that workspace.",
      403,
      "MOBILE_WORKSPACE_FORBIDDEN",
    );
  return verifiedUser;
}
