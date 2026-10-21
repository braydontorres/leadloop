import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ConfirmedCloudTransactionError,
  type LocalImportGateway,
} from "./local-import";
import type { Person, Store, Task } from "../tasks";
import type { Quote } from "../quotes";

export type CloudWorkspaceSummary = {
  id: string;
  name: string;
  businessName: string;
  ownerName: string;
  role: "owner" | "member";
};

/** Every web/native query carries workspace_id; database RLS remains authoritative. */
export type WorkspaceRepository = {
  listWorkspaces(): Promise<CloudWorkspaceSummary[]>;
  createWorkspace(input: {
    name: string;
    businessName: string;
    ownerName: string;
  }): Promise<CloudWorkspaceSummary>;
  loadStore(workspaceId: string): Promise<Store>;
  saveStore(workspaceId: string, store: Store): Promise<void>;
} & LocalImportGateway;

type DbError = { message?: string; code?: string };
function fail(error: DbError | null) {
  if (!error) return;
  throw new ConfirmedCloudTransactionError(
    error.code
      ? `${error.code}: ${error.message || "Cloud request failed."}`
      : error.message || "Cloud request failed.",
  );
}
function iso(value: string) {
  return value || new Date().toISOString();
}
function chunks<T>(items: T[], size = 200) {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) =>
    items.slice(index * size, index * size + size),
  );
}

function personFrom(row: any, interactions: any[]): Person {
  return {
    id: row.id,
    name: row.name,
    business: row.business ?? "",
    email: row.email ?? "",
    phone: row.phone ?? "",
    address: row.address ?? "",
    notes: row.notes ?? "",
    interactions: interactions
      .filter((entry) => entry.customer_id === row.id)
      .map((entry) => ({
        id: entry.id,
        note: entry.note,
        createdAt: entry.created_at,
      })),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
function quoteFrom(row: any, history: any[]): Quote {
  return {
    id: row.id,
    customerId: row.customer_id,
    serviceDescription: row.service_description,
    amountCents: row.amount_cents,
    currency: row.currency,
    status: row.status,
    notes: row.notes ?? "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    statusHistory: history
      .filter((entry) => entry.quote_id === row.id)
      .map((entry) => ({
        id: entry.id,
        from: entry.from_status,
        to: entry.to_status,
        changedAt: entry.changed_at,
      })),
  };
}
function taskFrom(row: any): Task {
  return {
    id: row.id,
    title: row.title,
    person: row.person ?? "",
    ...(row.person_id ? { personId: row.person_id } : {}),
    ...(row.quote_id ? { quoteId: row.quote_id } : {}),
    due: row.due ?? "",
    completed: row.completed,
    notes: row.notes ?? "",
  };
}

export type CloudStoreRows = {
  customers: Record<string, unknown>[];
  interactions: Record<string, unknown>[];
  quotes: Record<string, unknown>[];
  history: Record<string, unknown>[];
  tasks: Record<string, unknown>[];
};

/** Maps the existing browser Store without changing its stable IDs or links. */
export function storeToCloudRows(
  workspaceId: string,
  store: Store,
): CloudStoreRows {
  return {
    customers: store.people.map((person) => ({
      id: person.id,
      workspace_id: workspaceId,
      name: person.name,
      business: person.business,
      email: person.email,
      phone: person.phone,
      address: person.address,
      notes: person.notes,
      created_at: iso(person.createdAt),
      updated_at: iso(person.updatedAt),
    })),
    interactions: store.people.flatMap((person) =>
      person.interactions.map((entry) => ({
        id: entry.id,
        workspace_id: workspaceId,
        customer_id: person.id,
        note: entry.note,
        created_at: iso(entry.createdAt),
      })),
    ),
    quotes: store.quotes.map((quote) => ({
      id: quote.id,
      workspace_id: workspaceId,
      customer_id: quote.customerId,
      service_description: quote.serviceDescription,
      amount_cents: quote.amountCents,
      currency: quote.currency,
      status: quote.status,
      notes: quote.notes,
      created_at: iso(quote.createdAt),
      updated_at: iso(quote.updatedAt),
    })),
    history: store.quotes.flatMap((quote) =>
      quote.statusHistory.map((entry) => ({
        id: entry.id,
        workspace_id: workspaceId,
        quote_id: quote.id,
        from_status: entry.from,
        to_status: entry.to,
        changed_at: iso(entry.changedAt),
      })),
    ),
    tasks: store.tasks.map((task) => ({
      id: task.id,
      workspace_id: workspaceId,
      title: task.title,
      person: task.person,
      person_id: task.personId ?? null,
      quote_id: task.quoteId ?? null,
      due: task.due || null,
      completed: task.completed,
      notes: task.notes,
    })),
  };
}

export function storeFromCloudRows(input: {
  workspace: { name: string; business_name?: string | null };
  preferences: {
    timezone: string;
    working_days?: number[] | null;
    owner_name?: string | null;
  };
  customers: any[];
  interactions: any[];
  quotes: any[];
  history: any[];
  tasks: any[];
}): Store {
  return {
    tasks: input.tasks.map(taskFrom),
    people: input.customers.map((row) => personFrom(row, input.interactions)),
    quotes: input.quotes.map((row) => quoteFrom(row, input.history)),
    name: input.preferences.owner_name ?? "",
    business: input.workspace.business_name ?? input.workspace.name ?? "",
    timezone: input.preferences.timezone,
    workingDays: input.preferences.working_days ?? [1, 2, 3, 4, 5],
  };
}

async function rows(
  client: SupabaseClient,
  table: string,
  workspaceId: string,
) {
  const { data, error } = await client
    .from(table)
    .select("*")
    .eq("workspace_id", workspaceId);
  fail(error);
  return data ?? [];
}
async function deleteAbsent(
  client: SupabaseClient,
  table: string,
  workspaceId: string,
  ids: string[],
) {
  const existing = await rows(client, table, workspaceId);
  const keep = new Set(ids);
  const absent = existing
    .map((row: any) => row.id as string)
    .filter((id) => !keep.has(id));
  for (const group of chunks(absent)) {
    const { error } = await client
      .from(table)
      .delete()
      .eq("workspace_id", workspaceId)
      .in("id", group);
    fail(error);
  }
}
async function upsertRows(
  client: SupabaseClient,
  table: string,
  values: any[],
) {
  for (const group of chunks(values)) {
    if (!group.length) continue;
    const { error } = await client
      .from(table)
      .upsert(group, { onConflict: "workspace_id,id" });
    fail(error);
  }
}

export function createSupabaseWorkspaceRepository(
  client: SupabaseClient,
): WorkspaceRepository {
  return {
    async listWorkspaces() {
      const { data, error } = await client
        .from("workspace_members")
        .select(
          "workspace_id, role, workspaces(id, name, business_name, workspace_preferences(owner_name))",
        )
        .order("created_at");
      fail(error);
      return (data ?? []).flatMap((row: any) => {
        const workspace = Array.isArray(row.workspaces)
          ? row.workspaces[0]
          : row.workspaces;
        if (!workspace) return [];
        const preferences = Array.isArray(workspace.workspace_preferences)
          ? workspace.workspace_preferences[0]
          : workspace.workspace_preferences;
        return [
          {
            id: workspace.id,
            name: workspace.name,
            businessName: workspace.business_name ?? workspace.name,
            ownerName: preferences?.owner_name ?? "",
            role: row.role,
          } satisfies CloudWorkspaceSummary,
        ];
      });
    },
    async createWorkspace({ name, businessName, ownerName }) {
      const { data, error } = await client.rpc("create_workspace", {
        workspace_name:
          name.trim() || businessName.trim() || "LeadLoop workspace",
      });
      fail(error);
      const workspace = data as { id: string; name: string };
      const { error: workspaceError } = await client
        .from("workspaces")
        .update({ business_name: businessName.trim() })
        .eq("id", workspace.id);
      fail(workspaceError);
      const { error: preferenceError } = await client
        .from("workspace_preferences")
        .update({ owner_name: ownerName.trim() })
        .eq("workspace_id", workspace.id);
      fail(preferenceError);
      return {
        id: workspace.id,
        name: workspace.name,
        businessName: businessName.trim() || workspace.name,
        ownerName: ownerName.trim(),
        role: "owner",
      };
    },
    async loadStore(workspaceId) {
      const [
        workspaceResult,
        preferencesResult,
        customerRows,
        interactionRows,
        quoteRows,
        historyRows,
        taskRows,
      ] = await Promise.all([
        client
          .from("workspaces")
          .select("id, name, business_name")
          .eq("id", workspaceId)
          .single(),
        client
          .from("workspace_preferences")
          .select("timezone, working_days, owner_name")
          .eq("workspace_id", workspaceId)
          .single(),
        rows(client, "customers", workspaceId),
        rows(client, "customer_interactions", workspaceId),
        rows(client, "quotes", workspaceId),
        rows(client, "quote_status_history", workspaceId),
        rows(client, "tasks", workspaceId),
      ]);
      fail(workspaceResult.error);
      fail(preferencesResult.error);
      const workspace: any = workspaceResult.data;
      const preferences: any = preferencesResult.data;
      return storeFromCloudRows({
        workspace,
        preferences,
        customers: customerRows,
        interactions: interactionRows,
        quotes: quoteRows,
        history: historyRows,
        tasks: taskRows,
      });
    },
    async saveStore(workspaceId, store) {
      // Dependency order preserves customer/quote/task links; removals run in reverse.
      const { customers, interactions, quotes, history, tasks } =
        storeToCloudRows(workspaceId, store);
      await upsertRows(client, "customers", customers);
      await upsertRows(client, "customer_interactions", interactions);
      await upsertRows(client, "quotes", quotes);
      await upsertRows(client, "quote_status_history", history);
      await upsertRows(client, "tasks", tasks);
      const { error: workspaceError } = await client
        .from("workspaces")
        .update({
          name: store.business || store.name || "LeadLoop workspace",
          business_name: store.business,
        })
        .eq("id", workspaceId);
      fail(workspaceError);
      const { error: preferencesError } = await client
        .from("workspace_preferences")
        .upsert(
          {
            workspace_id: workspaceId,
            timezone: store.timezone,
            working_days: store.workingDays,
            owner_name: store.name,
          },
          { onConflict: "workspace_id" },
        );
      fail(preferencesError);
      await deleteAbsent(
        client,
        "quote_status_history",
        workspaceId,
        history.map((row) => String(row.id)),
      );
      await deleteAbsent(
        client,
        "customer_interactions",
        workspaceId,
        interactions.map((row) => String(row.id)),
      );
      await deleteAbsent(
        client,
        "tasks",
        workspaceId,
        tasks.map((row) => String(row.id)),
      );
      await deleteAbsent(
        client,
        "quotes",
        workspaceId,
        quotes.map((row) => String(row.id)),
      );
      await deleteAbsent(
        client,
        "customers",
        workspaceId,
        customers.map((row) => String(row.id)),
      );
    },
    async prepareImport({ workspaceId, sourceDigest, snapshotJson }) {
      const { data, error } = await client.rpc("prepare_local_import", {
        p_workspace_id: workspaceId,
        p_source_digest: sourceDigest,
        p_snapshot_json: snapshotJson,
      });
      fail(error);
      const result = data as any;
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
      const result = data as any;
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
