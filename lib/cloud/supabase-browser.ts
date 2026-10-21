import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type SupabaseBrowserConfig = { url: string; anonKey: string };
export type SupabaseBrowserEnvironment = {
  [key: string]: string | undefined;
  NEXT_PUBLIC_SUPABASE_URL?: string;
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?: string;
  NEXT_PUBLIC_SUPABASE_ANON_KEY?: string;
};

let client: SupabaseClient | null | undefined;
let configurationError: string | null | undefined;

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

function validateProjectBaseUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL must be a valid URL for the project base, such as https://your-project.supabase.co.",
    );
  }
  if (
    (parsed.protocol !== "https:" && parsed.protocol !== "http:") ||
    !parsed.hostname ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    (parsed.pathname !== "" && parsed.pathname !== "/")
  ) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL must be the project base URL only. Remove paths such as /auth/v1 or /rest/v1, query strings, and duplicate protocols.",
    );
  }
  return parsed.origin;
}

/** Reads only publishable Supabase values. Service-role and AI keys never belong in this module. */
export function readSupabaseBrowserConfig(
  env?: SupabaseBrowserEnvironment,
): SupabaseBrowserConfig | null {
  const source = env ?? browserPublicEnvironment();
  const rawUrl = source.NEXT_PUBLIC_SUPABASE_URL?.trim();
  // Supabase calls this the publishable key in newer projects; older projects
  // expose the same browser-safe credential as an anon key.
  const anonKey =
    source.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ||
    source.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!rawUrl || !anonKey) return null;
  return { url: validateProjectBaseUrl(rawUrl), anonKey };
}

/**
 * Returns null for local-only mode or a safely reported bad public config.
 * Call getSupabaseBrowserConfigurationError() to distinguish the two states.
 */
export function getSupabaseBrowserClient(): SupabaseClient | null {
  if (client !== undefined) return client;
  try {
    const config = readSupabaseBrowserConfig();
    configurationError = null;
    client = config
      ? createClient(config.url, config.anonKey, {
          auth: {
            persistSession: true,
            autoRefreshToken: true,
            // LeadLoop exchanges callback codes explicitly so it can show
            // confirmation/recovery-specific messages and clean the URL.
            detectSessionInUrl: false,
          },
        })
      : null;
  } catch (error) {
    configurationError =
      error instanceof Error
        ? error.message
        : "Supabase browser configuration is invalid.";
    client = null;
  }
  return client;
}

export function getSupabaseBrowserConfigurationError(): string | null {
  return configurationError ?? null;
}

export function resetSupabaseBrowserClientForTests() {
  client = undefined;
  configurationError = undefined;
}
