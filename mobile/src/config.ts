export type MobileSupabaseConfig = { url: string; anonKey: string };

export function mobileSupabaseConfig(
  env: Record<string, string | undefined>,
): MobileSupabaseConfig | null {
  const url = env.EXPO_PUBLIC_SUPABASE_URL?.trim();
  const anonKey =
    env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ||
    env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url || !anonKey) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(
      "EXPO_PUBLIC_SUPABASE_URL must be a valid project base URL.",
    );
  }
  if (
    !["https:", "http:"].includes(parsed.protocol) ||
    !parsed.hostname ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    (parsed.pathname !== "" && parsed.pathname !== "/")
  )
    throw new Error(
      "EXPO_PUBLIC_SUPABASE_URL must be the project base URL only, without /auth/v1 or /rest/v1.",
    );
  return { url: parsed.origin, anonKey };
}

export const MOBILE_WORKSPACE_KEY = "leadloop.mobile.workspace.v1";
export function workspacePreferenceKey(userId: string) {
  return `${MOBILE_WORKSPACE_KEY}.${userId}`;
}
