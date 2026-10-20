import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type SupabaseBrowserConfig = { url: string; anonKey: string };

let client: SupabaseClient | null | undefined;

/** Reads only publishable Supabase values. Service-role and AI keys never belong in this module. */
export function readSupabaseBrowserConfig(
  env: Record<string, string | undefined> = process.env,
): SupabaseBrowserConfig | null {
  const url = env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url || !anonKey) return null;
  try {
    new URL(url);
  } catch {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL must be a valid URL.");
  }
  return { url, anonKey };
}

/**
 * Returns null while cloud configuration is absent so the local-only app keeps
 * working. Callers must require an authenticated workspace before data access.
 */
export function getSupabaseBrowserClient(): SupabaseClient | null {
  if (client !== undefined) return client;
  const config = readSupabaseBrowserConfig();
  client = config
    ? createClient(config.url, config.anonKey, {
        auth: { persistSession: true, autoRefreshToken: true },
      })
    : null;
  return client;
}

export function resetSupabaseBrowserClientForTests() {
  client = undefined;
}
