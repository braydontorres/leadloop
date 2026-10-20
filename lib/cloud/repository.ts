import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  CloudCustomer,
  CloudImportCounts,
  CloudImportResult,
  CloudQuote,
  CloudTask,
  LocalCloudSnapshot,
} from "./types";

/**
 * Typed boundary used by the web app today and React Native later. Every query
 * carries workspace_id; database RLS still enforces the same boundary.
 */
export type WorkspaceRepository = {
  listCustomers(workspaceId: string): Promise<CloudCustomer[]>;
  listQuotes(workspaceId: string): Promise<CloudQuote[]>;
  listTasks(workspaceId: string): Promise<CloudTask[]>;
  importSnapshot(input: {
    workspaceId: string;
    sourceFingerprint: string;
    snapshot: LocalCloudSnapshot;
  }): Promise<CloudImportResult>;
};

function fail(error: { message?: string } | null) {
  if (error) throw new Error(error.message || "Cloud request failed.");
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
    async importSnapshot({ workspaceId, sourceFingerprint, snapshot }) {
      // RPC performs a single transaction, records the source fingerprint, and
      // is idempotent when a previous interrupted browser request is retried.
      const { data, error } = await client.rpc("import_local_workspace", {
        p_workspace_id: workspaceId,
        p_source_fingerprint: sourceFingerprint,
        p_snapshot: snapshot,
      });
      fail(error);
      const result = data as {
        import_id: string;
        duplicate: boolean;
        counts: CloudImportCounts;
      };
      return {
        importId: result.import_id,
        duplicate: result.duplicate,
        counts: result.counts,
      };
    },
  };
}
