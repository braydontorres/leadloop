import { createClient } from "@supabase/supabase-js";
import { ApiError } from "./ai-server";

type AuthenticatedMobileUser = { id: string };

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
  const value = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(value);
  if (!match || match[1].length > 8192)
    throw new ApiError(
      "Sign in before using voice capture.",
      401,
      "MOBILE_AUTH_REQUIRED",
    );
  return match[1];
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
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user)
    throw new ApiError(
      "Your sign-in session has expired. Sign in again.",
      401,
      "MOBILE_AUTH_REQUIRED",
    );
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
  return { id: data.user.id };
}
