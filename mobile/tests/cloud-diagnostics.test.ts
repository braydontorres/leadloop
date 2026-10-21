import assert from "node:assert/strict";
import test from "node:test";
import {
  cloudDiagnostic,
  MobileRepositoryError,
} from "../src/cloud-diagnostics";

test("workspace diagnostics distinguish access from transient and data failures", () => {
  assert.deepEqual(
    cloudDiagnostic(
      "tasks",
      new MobileRepositoryError("tasks", "42501", "permission denied"),
    ),
    { operation: "tasks", code: "42501", kind: "access" },
  );
  assert.equal(
    cloudDiagnostic("workspace_list", new Error("fetch failed")).kind,
    "network",
  );
  assert.equal(
    cloudDiagnostic(
      "quotes",
      new MobileRepositoryError("quotes", "PGRST205", "schema cache miss"),
    ).kind,
    "data",
  );
});

test("an optional quote failure cannot be labeled revoked workspace access", () => {
  const diagnostic = cloudDiagnostic(
    "quotes_optional",
    new MobileRepositoryError("quotes", "PGRST205", "schema cache miss"),
  );
  assert.notEqual(diagnostic.kind, "access");
});
