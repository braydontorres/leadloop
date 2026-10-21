import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type SupabaseBrowserConfig = { url: string; anonKey: string };
export type SupabaseBrowserEnvironment = {
  [key: string]: string | undefined;
  NEXT_PUBLIC_SUPABASE_URL?: string;
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?: string;
  NEXT_PUBLIC_SUPABASE_ANON_KEY?: string;
};

let client: SupabaseClient | null | undefined;

/**
 * Keep these direct property reads here. Next.js replaces statically referenced
 * `NEXT_PUBLIC_*` values in client bundles, while dynamic `process.env[key]`
 * access is not guaranteed to be inlined for the browser.
 */
function browserPublicEnvironment(): SupabaseBrowserEnvironment {
  return {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  };
}

/** Reads only publishable Supabase values. Service-role and AI keys never belong in this module. */
export function readSupabaseBrowserConfig(
  env?: SupabaseBrowserEnvironment,
): SupabaseBrowserConfig | null {
  const source = env ?? browserPublicEnvironment();
  const url = source.NEXT_PUBLIC_SUPABASE_URL?.trim();
  // Supabase calls this the publishable key in newer projects; older projects
  // expose the same browser-safe credential as an anon key.
  const anonKey =
    source.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ||
    source.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
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
