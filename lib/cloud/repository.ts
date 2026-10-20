import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ConfirmedCloudTransactionError,
  type LocalImportGateway,
} from "./local-import";
import type {
  CloudCustomer,
  CloudImportPreparation,
  CloudImportResult,
  CloudQuote,
  CloudTask,
} from "./types";

/** Every web/native query carries workspace_id; PostgreSQL RLS remains authoritative. */
export type WorkspaceRepository = {
  listCustomers(workspaceId: string): Promise<CloudCustomer[]>;
  listQuotes(workspaceId: string): Promise<CloudQuote[]>;
  listTasks(workspaceId: string): Promise<CloudTask[]>;
} & LocalImportGateway;

function fail(error: { message?: string; code?: string } | null) {
  if (!error) return;
  const failure = new ConfirmedCloudTransactionError(
    error.code
      ? `${error.code}: ${error.message || "Cloud request failed."}`
      : error.message || "Cloud request failed.",
  );
  throw failure;
}

export function createSupabaseWorkspaceRepository(
  client: SupabaseClient,
): WorkspaceRepository {
  return {
    async listCustomers(workspaceId) {
      const { data, error } = await client
        .from("customers")
        .select("*")
        .eq("workspace_id", workspaceId)
        .order("name");
      fail(error);
      return (data ?? []).map((row: any) => ({
        id: row.id,
        workspaceId: row.workspace_id,
        name: row.name,
        business: row.business ?? "",
        email: row.email ?? "",
        phone: row.phone ?? "",
        address: row.address ?? "",
        notes: row.notes ?? "",
        interactions: [],
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }));
    },
    async listQuotes(workspaceId) {
      const { data, error } = await client
        .from("quotes")
        .select("*, quote_status_history(*)")
        .eq("workspace_id", workspaceId)
        .order("created_at");
      fail(error);
      return (data ?? []).map((row: any) => ({
        id: row.id,
        workspaceId: row.workspace_id,
        customerId: row.customer_id,
        serviceDescription: row.service_description,
        amountCents: row.amount_cents,
        currency: row.currency,
        status: row.status,
        notes: row.notes ?? "",
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        statusHistory: (row.quote_status_history ?? []).map((change: any) => ({
          id: change.id,
          from: change.from_status,
          to: change.to_status,
          changedAt: change.changed_at,
        })),
      }));
    },
    async listTasks(workspaceId) {
      const { data, error } = await client
        .from("tasks")
        .select("*")
        .eq("workspace_id", workspaceId)
        .order("due", { ascending: true, nullsFirst: false });
      fail(error);
      return (data ?? []).map((row: any) => ({
        id: row.id,
        workspaceId: row.workspace_id,
        title: row.title,
        person: row.person ?? "",
        personId: row.person_id ?? undefined,
        quoteId: row.quote_id ?? undefined,
        due: row.due ?? "",
        completed: row.completed,
        notes: row.notes ?? "",
      }));
    },
    async prepareImport({ workspaceId, sourceDigest, snapshotJson }) {
      const { data, error } = await client.rpc("prepare_local_import", {
        p_workspace_id: workspaceId,
        p_source_digest: sourceDigest,
        p_snapshot_json: snapshotJson,
      });
      fail(error);
      const result = data as {
        import_id: string | null;
        duplicate: boolean;
        ready: boolean;
        conflicts: CloudImportPreparation["conflicts"];
        counts?: CloudImportPreparation["counts"];
      };
      return {
        importId: result.import_id,
        duplicate: result.duplicate,
        ready: result.ready,
        conflicts: result.conflicts,
        counts: result.counts,
      };
    },
    async importPreparedSnapshot({
      workspaceId,
      importId,
      sourceDigest,
      snapshotJson,
    }) {
      const { data, error } = await client.rpc("import_local_workspace", {
        p_workspace_id: workspaceId,
        p_import_id: importId,
        p_source_digest: sourceDigest,
        p_snapshot_json: snapshotJson,
      });
      fail(error);
      const result = data as {
        import_id: string;
        duplicate: boolean;
        counts: CloudImportResult["counts"];
      };
      return {
        importId: result.import_id,
        duplicate: result.duplicate,
        counts: result.counts,
      };
    },
    async markRolledBack({ workspaceId, importId, reason }) {
      const { error } = await client.rpc("mark_local_import_rolled_back", {
        p_workspace_id: workspaceId,
        p_import_id: importId,
        p_reason: reason,
      });
      fail(error);
    },
  };
}
