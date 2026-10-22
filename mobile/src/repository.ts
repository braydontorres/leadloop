import type { SupabaseClient } from "@supabase/supabase-js";
import type { Person, Task } from "../../lib/tasks";
import type { Quote, QuoteStatus } from "../../lib/quotes";
import {
  cloudDiagnostic,
  type CloudDiagnostic,
  MobileRepositoryError,
} from "./cloud-diagnostics";

export type MobileWorkspace = {
  id: string;
  name: string;
  businessName: string;
  role: "owner" | "member";
};
export type MobileWorkspaceData = {
  workspace: MobileWorkspace;
  timezone: string;
  people: Person[];
  quotes: Quote[];
  tasks: Task[];
  diagnostics: CloudDiagnostic[];
};

type DatabaseError = { message?: string; code?: string };
function fail(operation: string, error: DatabaseError | null) {
  if (!error) return;
  throw new MobileRepositoryError(
    operation,
    error.code ?? null,
    error.message || "Cloud request failed.",
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
      .filter((interaction) => interaction.customer_id === row.id)
      .map((interaction) => ({
        id: interaction.id,
        note: interaction.note,
        createdAt: interaction.created_at,
      })),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
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
    // PostgreSQL returns a boolean here. Do not use Boolean("false"), which
    // would incorrectly hide an open reminder if a legacy transport encoded
    // it as a string.
    completed: row.completed === true,
    notes: row.notes ?? "",
  };
}
function quoteFrom(row: any): Quote {
  return {
    id: row.id,
    customerId: row.customer_id,
    serviceDescription: row.service_description,
    amountCents: row.amount_cents,
    currency: "USD",
    status: row.status as QuoteStatus,
    notes: row.notes ?? "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    // Voice reminder linking only needs the stable quote identity. The web
    // profile remains responsible for rendering its complete history.
    statusHistory: [],
  };
}

/** Mobile uses the same tables and RLS boundaries as the web repository. */
export async function listMobileWorkspaces(client: SupabaseClient) {
  const { data, error } = await client
    .from("workspace_members")
    .select("workspace_id, role, workspaces(id, name, business_name)")
    .order("created_at");
  fail("workspace_list", error);
  return (data ?? []).flatMap((row: any) => {
    const workspace = Array.isArray(row.workspaces)
      ? row.workspaces[0]
      : row.workspaces;
    if (!workspace) return [];
    return [
      {
        id: workspace.id,
        name: workspace.name,
        businessName: workspace.business_name ?? workspace.name,
        role: row.role,
      } satisfies MobileWorkspace,
    ];
  });
}

export async function loadMobileWorkspace(
  client: SupabaseClient,
  workspace: MobileWorkspace,
): Promise<MobileWorkspaceData> {
  const [
    preferenceResult,
    customersResult,
    interactionsResult,
    quotesResult,
    tasksResult,
  ] = await Promise.all([
    client
      .from("workspace_preferences")
      .select("timezone")
      .eq("workspace_id", workspace.id)
      .single(),
    client.from("customers").select("*").eq("workspace_id", workspace.id),
    client
      .from("customer_interactions")
      .select("*")
      .eq("workspace_id", workspace.id),
    client.from("quotes").select("*").eq("workspace_id", workspace.id),
    client
      .from("tasks")
      .select("*")
      .eq("workspace_id", workspace.id)
      .order("due", { ascending: true, nullsFirst: false }),
  ]);
  fail("workspace_preferences", preferenceResult.error);
  fail("customers", customersResult.error);
  fail("customer_interactions", interactionsResult.error);
  fail("tasks", tasksResult.error);
  // Quotes enrich a reminder link but are not required to restore the
  // workspace. A broken optional quote query must never make existing tasks
  // look unauthorized or erase an otherwise usable workspace.
  const diagnostics = quotesResult.error
    ? [
        cloudDiagnostic(
          "quotes_optional",
          new MobileRepositoryError(
            "quotes_optional",
            quotesResult.error.code ?? null,
            quotesResult.error.message,
          ),
        ),
      ]
    : [];
  const quotes = quotesResult.error
    ? []
    : (quotesResult.data ?? []).map(quoteFrom);
  return {
    workspace,
    timezone: preferenceResult.data?.timezone ?? "America/Chicago",
    people: (customersResult.data ?? []).map((person) =>
      personFrom(person, interactionsResult.data ?? []),
    ),
    quotes,
    tasks: (tasksResult.data ?? []).map(taskFrom),
    diagnostics,
  };
}

export async function createMobileTask(
  client: SupabaseClient,
  input: Task & { workspaceId: string },
) {
  // The voice confirmation path retries the same application-generated ID
  // after a connection drop. This makes that retry idempotent without
  // creating a second reminder.
  const { error } = await client.from("tasks").upsert(
    {
      id: input.id,
      workspace_id: input.workspaceId,
      title: input.title.trim(),
      person: input.person,
      person_id: input.personId ?? null,
      quote_id: input.quoteId ?? null,
      due: input.due || null,
      completed: false,
      notes: input.notes,
    },
    { onConflict: "workspace_id,id" },
  );
  fail("task_create", error);
}

export async function setMobileTaskCompleted(
  client: SupabaseClient,
  workspaceId: string,
  taskId: string,
  completed: boolean,
) {
  const { error } = await client
    .from("tasks")
    .update({ completed })
    .eq("workspace_id", workspaceId)
    .eq("id", taskId);
  fail("task_complete", error);
}
