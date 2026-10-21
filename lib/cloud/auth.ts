import type { Session, SupabaseClient, User } from "@supabase/supabase-js";

export type AuthState = { session: Session | null; user: User | null };
export type AuthCallbackResult = {
  kind: "none" | "confirmation" | "recovery";
  session: Session | null;
};

type RecoveryStorage = Pick<Storage, "getItem" | "removeItem" | "setItem">;
const RECOVERY_REQUEST_KEY = "leadloop.cloud.password-recovery-request.v1";
const RECOVERY_SESSION_KEY = "leadloop.cloud.password-recovery-session.v1";
const RECOVERY_SESSION_LIFETIME_MS = 15 * 60 * 1000;

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

/** Supabase preserves this non-secret flow hint alongside its PKCE code. */
export function passwordRecoveryRedirectUrl(origin: string): string {
  const url = new URL(authRedirectUrl(origin));
  url.searchParams.set("auth_callback", "1");
  url.searchParams.set("flow", "recovery");
  return url.toString();
}

/** Records intent only; the provider session remains the authority. */
export function markPasswordRecoveryRequested(storage: RecoveryStorage) {
  try {
    storage.setItem(RECOVERY_REQUEST_KEY, "1");
  } catch {
    // Private browsing can deny storage. The redirect flow hint still works.
  }
}

export function hasPasswordRecoveryRequest(storage: RecoveryStorage) {
  try {
    return storage.getItem(RECOVERY_REQUEST_KEY) === "1";
  } catch {
    return false;
  }
}

export function clearPasswordRecoveryRequest(storage: RecoveryStorage) {
  try {
    storage.removeItem(RECOVERY_REQUEST_KEY);
  } catch {
    // No local marker is required for server-side session security.
  }
}

/** Keeps recovery UI available across a refresh only for its exchanged session. */
export function markPasswordRecoverySession(
  storage: RecoveryStorage,
  userId: string,
  now = Date.now(),
) {
  try {
    storage.setItem(
      RECOVERY_SESSION_KEY,
      JSON.stringify({ userId, expiresAt: now + RECOVERY_SESSION_LIFETIME_MS }),
    );
  } catch {
    // The active in-memory session still permits this recovery attempt.
  }
}

export function hasPasswordRecoverySession(
  storage: RecoveryStorage,
  userId: string,
  now = Date.now(),
) {
  try {
    const raw = storage.getItem(RECOVERY_SESSION_KEY);
    if (!raw) return false;
    const value = JSON.parse(raw) as { userId?: unknown; expiresAt?: unknown };
    const valid =
      value.userId === userId &&
      typeof value.expiresAt === "number" &&
      value.expiresAt > now;
    if (!valid) storage.removeItem(RECOVERY_SESSION_KEY);
    return valid;
  } catch {
    return false;
  }
}

export function clearPasswordRecoverySession(storage: RecoveryStorage) {
  try {
    storage.removeItem(RECOVERY_SESSION_KEY);
  } catch {
    // The provider session is still invalidated by sign-out or expiry.
  }
}

export function validateNewPassword(password: string, confirmation: string) {
  const value = requirePassword(password, "set");
  if (value !== confirmation) throw new Error("New passwords do not match.");
  return value;
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
  options: { recoveryIntent?: boolean } = {},
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
  const recoveryIntent =
    type === "recovery" ||
    url.searchParams.get("flow") === "recovery" ||
    options.recoveryIntent === true;
  const kind = recoveryIntent ? "recovery" : type ? "confirmation" : "none";
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
