import { createClient } from "@supabase/supabase-js";
import { ApiError } from "./ai-server";

type AuthenticatedMobileUser = { id: string };

type SupabaseAuthError = {
  status?: unknown;
  code?: unknown;
  name?: unknown;
  message?: unknown;
};

export type MobileVoiceAuthDiagnostic = {
  stage: "header" | "supabase_get_user";
  outcome:
    | "missing_header"
    | "malformed_header"
    | "token_rejected"
    | "project_key_rejected"
    | "auth_rejected"
    | "service_unavailable";
  providerStatus: number | null;
  providerCode: string | null;
  configSource: MobileVoiceSupabaseConfig["source"] | null;
};

type ServerEnvironment = Record<string, string | undefined>;
type MobileVoiceKeySource =
  | "server_publishable"
  | "server_anon"
  | "development_public_publishable"
  | "development_public_anon";

export type MobileVoiceSupabaseConfig = {
  url: string;
  key: string;
  source: MobileVoiceKeySource;
};

type MobileVoiceAuthError = ApiError & {
  mobileVoiceAuthDiagnostic?: MobileVoiceAuthDiagnostic;
};

function environmentValue(environment: ServerEnvironment, name: string) {
  return environment[name]?.trim() || undefined;
}

function configurationError(message: string, code: string) {
  return new ApiError(message, 503, code);
}

function projectBaseUrl(value: string) {
  try {
    const url = new URL(value);
    if (
      !["https:", "http:"].includes(url.protocol) ||
      !url.hostname ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      (url.pathname !== "" && url.pathname !== "/")
    )
      throw new Error("Invalid project URL");
    return url.origin;
  } catch {
    throw configurationError(
      "LeadLoop cloud authentication has an invalid server project URL.",
      "MOBILE_AUTH_CONFIG_INVALID",
    );
  }
}

/**
 * Reads server-only runtime configuration. `NEXT_PUBLIC_*` names are allowed
 * only for local development; Next.js substitutes those names while building a
 * production bundle and they are not safe for a server-side auth boundary.
 */
export function mobileVoiceSupabaseConfig(
  environment: ServerEnvironment = process.env,
): MobileVoiceSupabaseConfig {
  const isProduction =
    environmentValue(environment, "NODE_ENV") === "production";
  const runtimeUrl = environmentValue(environment, "SUPABASE_URL");
  const runtimePublishable = environmentValue(
    environment,
    "SUPABASE_PUBLISHABLE_KEY",
  );
  const runtimeAnon = environmentValue(environment, "SUPABASE_ANON_KEY");
  const publicUrl = environmentValue(environment, "NEXT_PUBLIC_SUPABASE_URL");
  const publicPublishable = environmentValue(
    environment,
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  );
  const publicAnon = environmentValue(
    environment,
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  );

  if (runtimePublishable && runtimeAnon && runtimePublishable !== runtimeAnon)
    throw configurationError(
      "LeadLoop cloud authentication has conflicting server key settings.",
      "MOBILE_AUTH_CONFIG_AMBIGUOUS",
    );
  if (
    !isProduction &&
    publicPublishable &&
    publicAnon &&
    publicPublishable !== publicAnon
  )
    throw configurationError(
      "LeadLoop cloud authentication has conflicting public key settings.",
      "MOBILE_AUTH_CONFIG_AMBIGUOUS",
    );

  const url = runtimeUrl ?? (!isProduction ? publicUrl : undefined);
  const key = runtimePublishable ?? runtimeAnon;
  const source: MobileVoiceKeySource | undefined = runtimePublishable
    ? "server_publishable"
    : runtimeAnon
      ? "server_anon"
      : !isProduction && publicPublishable
        ? "development_public_publishable"
        : !isProduction && publicAnon
          ? "development_public_anon"
          : undefined;
  const configuredKey =
    key ?? (!isProduction ? (publicPublishable ?? publicAnon) : undefined);
  if (!url || !configuredKey || !source)
    throw new ApiError(
      isProduction
        ? "LeadLoop cloud authentication needs server runtime configuration."
        : "LeadLoop cloud authentication is not configured on this server.",
      503,
      isProduction
        ? "MOBILE_AUTH_RUNTIME_CONFIG_REQUIRED"
        : "MOBILE_AUTH_NOT_CONFIGURED",
    );
  return { url: projectBaseUrl(url), key: configuredKey, source };
}

function bearerToken(request: Request) {
  const value = request.headers.get("authorization");
  if (!value)
    throw authError(
      "LeadLoop did not receive a sign-in authorization. Reopen the app and try again.",
      401,
      "MOBILE_AUTH_HEADER_MISSING",
      {
        stage: "header",
        outcome: "missing_header",
        providerStatus: null,
        providerCode: null,
        configSource: null,
      },
    );
  const match = /^Bearer\s+(.+)$/i.exec(value);
  if (!match || match[1].length > 8192)
    throw authError(
      "LeadLoop received an invalid sign-in authorization. Sign in again before recording.",
      401,
      "MOBILE_AUTH_HEADER_MALFORMED",
      {
        stage: "header",
        outcome: "malformed_header",
        providerStatus: null,
        providerCode: null,
        configSource: null,
      },
    );
  return match[1];
}

function authFailureStatus(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const status = (error as SupabaseAuthError).status;
  return typeof status === "number" ? status : undefined;
}

function safeProviderCode(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const code = (error as SupabaseAuthError).code;
  return typeof code === "string" && /^[a-z0-9_]{1,80}$/i.test(code)
    ? code
    : null;
}

function safeProviderMessage(error: unknown): string {
  if (!error || typeof error !== "object") return "";
  const message = (error as SupabaseAuthError).message;
  return typeof message === "string" ? message : "";
}

function rejectionOutcome(
  error: unknown,
): MobileVoiceAuthDiagnostic["outcome"] {
  // We inspect these provider phrases only to select a fixed, safe category.
  // The provider message itself is never returned or logged.
  const message = safeProviderMessage(error).toLowerCase();
  if (/api[- ]?key|publishable key|anon key/.test(message))
    return "project_key_rejected";
  if (/jwt|token|session/.test(message)) return "token_rejected";
  return "auth_rejected";
}

function authDiagnostic(
  stage: MobileVoiceAuthDiagnostic["stage"],
  outcome: MobileVoiceAuthDiagnostic["outcome"],
  configSource: MobileVoiceSupabaseConfig["source"],
  error?: unknown,
): MobileVoiceAuthDiagnostic {
  return {
    stage,
    outcome,
    providerStatus: authFailureStatus(error) ?? null,
    providerCode: safeProviderCode(error),
    configSource,
  };
}

function authError(
  message: string,
  status: number,
  code: string,
  diagnostic: MobileVoiceAuthDiagnostic,
) {
  const error = new ApiError(message, status, code) as MobileVoiceAuthError;
  error.mobileVoiceAuthDiagnostic = diagnostic;
  return error;
}

export function mobileVoiceAuthDiagnostic(
  error: unknown,
): MobileVoiceAuthDiagnostic | null {
  return error instanceof ApiError
    ? ((error as MobileVoiceAuthError).mobileVoiceAuthDiagnostic ?? null)
    : null;
}

function rejectedTokenError(
  configSource: MobileVoiceSupabaseConfig["source"],
  error?: unknown,
) {
  const outcome = rejectionOutcome(error);
  const projectKeyRejected = outcome === "project_key_rejected";
  return authError(
    projectKeyRejected
      ? "LeadLoop's secure cloud configuration rejected this request. Please try again later."
      : "Your sign-in session was rejected. Sign out and sign in again before recording.",
    401,
    projectKeyRejected
      ? "MOBILE_AUTH_PROJECT_KEY_REJECTED"
      : "MOBILE_AUTH_TOKEN_REJECTED",
    authDiagnostic("supabase_get_user", outcome, configSource, error),
  );
}

function authServiceError(
  configSource: MobileVoiceSupabaseConfig["source"],
  error?: unknown,
) {
  return authError(
    "LeadLoop could not verify your sign-in right now. Check your connection and try again.",
    503,
    "MOBILE_AUTH_SERVICE_UNAVAILABLE",
    authDiagnostic(
      "supabase_get_user",
      "service_unavailable",
      configSource,
      error,
    ),
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
  const { url, key, source } = mobileVoiceSupabaseConfig();
  const client = createClient(url, key, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  let verifiedUser: { id: string } | null = null;
  try {
    const { data, error } = await client.auth.getUser(token);
    if (data.user) verifiedUser = { id: data.user.id };
    else if (isRejectedAuthStatus(authFailureStatus(error)))
      throw rejectedTokenError(source, error);
    else if (error) throw authServiceError(source, error);
    else throw rejectedTokenError(source);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (isRejectedAuthStatus(authFailureStatus(error)))
      throw rejectedTokenError(source, error);
    throw authServiceError(source, error);
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
