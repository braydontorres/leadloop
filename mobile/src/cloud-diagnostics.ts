export type CloudFailureKind =
  "network" | "authentication" | "access" | "data" | "unknown";

export type CloudDiagnostic = {
  operation: string;
  code: string | null;
  kind: CloudFailureKind;
  outcome: "failed" | "succeeded";
};

export class MobileRepositoryError extends Error {
  constructor(
    public readonly operation: string,
    public readonly code: string | null,
    message: string,
  ) {
    super(message);
    this.name = "MobileRepositoryError";
  }
}

export function cloudDiagnostic(
  operation: string,
  error: unknown,
): CloudDiagnostic {
  const message = error instanceof Error ? error.message : "";
  const known = error instanceof MobileRepositoryError ? error : null;
  const code = known?.code ?? /\b([A-Z0-9]{5})\b/.exec(message)?.[1] ?? null;
  const operationName = known?.operation ?? operation;
  if (/network|fetch|offline|timed? out|reach/i.test(message))
    return {
      operation: operationName,
      code,
      kind: "network",
      outcome: "failed",
    };
  if (/jwt|session|token|unauthenticated|401/i.test(message))
    return {
      operation: operationName,
      code,
      kind: "authentication",
      outcome: "failed",
    };
  if (
    /42501|permission denied|row-level security|not allowed|403/i.test(message)
  )
    return {
      operation: operationName,
      code,
      kind: "access",
      outcome: "failed",
    };
  if (known || /PGRST|schema|relation|column/i.test(message))
    return {
      operation: operationName,
      code,
      kind: "data",
      outcome: "failed",
    };
  return {
    operation: operationName,
    code,
    kind: "unknown",
    outcome: "failed",
  };
}

export function cloudSuccess(operation: string): CloudDiagnostic {
  return { operation, code: null, kind: "unknown", outcome: "succeeded" };
}

/** Logs only operation metadata: never a token, query, or customer record. */
export function logCloudDiagnostic(diagnostic: CloudDiagnostic) {
  console.info("[LeadLoop mobile cloud]", JSON.stringify(diagnostic));
}
