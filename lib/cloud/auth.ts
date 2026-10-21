import type { Session, SupabaseClient, User } from "@supabase/supabase-js";

export type AuthState = { session: Session | null; user: User | null };
export type AuthCallbackResult = {
  kind: "none" | "confirmation" | "recovery";
  session: Session | null;
};

type ProviderError = { message?: string; status?: number; code?: string };

function normalizedEmail(email: string) {
  const value = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))
    throw new Error("Enter a valid email address.");
  return value;
}

function requirePassword(password: string, action: "sign_in" | "set") {
  if (!password)
    throw new Error(
      action === "sign_in" ? "Enter your password." : "Enter a new password.",
    );
  if (action === "set" && password.length < 8)
    throw new Error("Use a password with at least 8 characters.");
  return password;
}

/** Converts provider/network errors into actionable text without exposing data. */
export function authErrorMessage(error: unknown): string {
  const provider = error as ProviderError | undefined;
  const message = provider?.message?.trim() || "";
  const lower = message.toLowerCase();
  if (/invalid path|invalid redirect|redirect.*url|request uri/.test(lower))
    return "Supabase rejected the request URL. Set NEXT_PUBLIC_SUPABASE_URL to your project base URL only, for example https://your-project.supabase.co, without /auth/v1 or /rest/v1.";
  if (
    /already registered|already been registered|user already exists/.test(lower)
  )
    return "An account with that email already exists. Sign in or reset your password.";
  if (/invalid login credentials|invalid credentials/.test(lower))
    return "Email or password is incorrect.";
  if (/password.*(weak|short|least)|weak password/.test(lower))
    return "Use a stronger password with at least 8 characters.";
  if (/session expired/.test(lower)) return "Session expired. Sign in again.";
  if (/expired|otp.*invalid|token.*invalid|code verifier/.test(lower))
    return "This confirmation or recovery link has expired. Request a new one.";
  if (/email.*not confirmed/.test(lower))
    return "Confirm your email before signing in. Check your inbox for a new confirmation link.";
  if (/rate limit|too many/.test(lower) || provider?.status === 429)
    return "Too many authentication attempts. Please wait a few minutes and try again.";
  if (/fetch|network|failed to fetch|offline/.test(lower))
    return "Could not reach Supabase. Check your connection and try again.";
  return message || "Authentication request failed. Please try again.";
}

function fail(error: ProviderError | null) {
  if (error) throw new Error(authErrorMessage(error));
}

export function authRedirectUrl(origin: string): string {
  let base: URL;
  try {
    base = new URL(origin);
  } catch {
    throw new Error(
      "This browser origin is invalid. Open LeadLoop from its normal web address and try again.",
    );
  }
  if (base.protocol !== "https:" && base.protocol !== "http:")
    throw new Error("This browser origin must use http or https.");
  // Use the configured site root instead of requiring an extra callback path
  // or query-string allow-list entry in Supabase Auth.
  return new URL("/", base.origin).toString();
}

export async function currentAuth(client: SupabaseClient): Promise<AuthState> {
  const { data, error } = await client.auth.getSession();
  fail(error);
  return { session: data.session, user: data.session?.user ?? null };
}

export async function signUpWithEmail(
  client: SupabaseClient,
  email: string,
  password: string,
  redirectTo: string,
) {
  const { data, error } = await client.auth.signUp({
    email: normalizedEmail(email),
    password: requirePassword(password, "set"),
    options: { emailRedirectTo: redirectTo },
  });
  fail(error);
  return data;
}

export async function signInWithEmail(
  client: SupabaseClient,
  email: string,
  password: string,
) {
  const { data, error } = await client.auth.signInWithPassword({
    email: normalizedEmail(email),
    password: requirePassword(password, "sign_in"),
  });
  fail(error);
  return data;
}

export async function sendPasswordRecovery(
  client: SupabaseClient,
  email: string,
  redirectTo: string,
) {
  const { error } = await client.auth.resetPasswordForEmail(
    normalizedEmail(email),
    { redirectTo },
  );
  fail(error);
}

export async function updatePassword(client: SupabaseClient, password: string) {
  const { error } = await client.auth.updateUser({
    password: requirePassword(password, "set"),
  });
  fail(error);
}

/** Exchanges PKCE confirmation/recovery codes and supports legacy implicit links. */
export async function completeAuthCallback(
  client: SupabaseClient,
  href: string,
): Promise<AuthCallbackResult> {
  const url = new URL(href);
  const fragment = new URLSearchParams(url.hash.replace(/^#/, ""));
  const providerError =
    url.searchParams.get("error_description") ||
    url.searchParams.get("error") ||
    fragment.get("error_description") ||
    fragment.get("error");
  if (providerError)
    throw new Error(authErrorMessage({ message: providerError }));
  const type = url.searchParams.get("type") || fragment.get("type");
  const kind =
    type === "recovery" ? "recovery" : type ? "confirmation" : "none";
  const code = url.searchParams.get("code");
  if (!code) {
    const accessToken = fragment.get("access_token");
    const refreshToken = fragment.get("refresh_token");
    if (!accessToken || !refreshToken) return { kind, session: null };
    const { data, error } = await client.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });
    fail(error);
    return { kind, session: data.session };
  }
  const { data, error } = await client.auth.exchangeCodeForSession(code);
  fail(error);
  return { kind, session: data.session };
}

export async function signOut(client: SupabaseClient) {
  const { error } = await client.auth.signOut();
  fail(error);
}
