import { STORAGE_KEY, migrateStore, type Store } from "../tasks";
import type {
  CloudImportConflicts,
  CloudImportCounts,
  CloudImportPreparation,
  CloudImportPreview,
  CloudImportResult,
  LocalCloudSnapshot,
} from "./types";

const BACKUP_SUFFIX = ".cloud-import-backup.v1";
const JOURNAL_SUFFIX = ".cloud-import-journal.v1";
type StorageLike = Pick<Storage, "getItem" | "setItem">;

export type LocalImportGateway = {
  prepareImport(input: {
    workspaceId: string;
    sourceDigest: string;
    snapshotJson: string;
  }): Promise<CloudImportPreparation>;
  importPreparedSnapshot(input: {
    workspaceId: string;
    importId: string;
    sourceDigest: string;
    snapshotJson: string;
  }): Promise<CloudImportResult>;
  markRolledBack(input: {
    workspaceId: string;
    importId: string;
    reason: string;
  }): Promise<void>;
};

export type ImportJournal = {
  workspaceId: string;
  sourceDigest: string;
  importId: string | null;
  startedAt: string;
};

export class LocalImportConflictError extends Error {
  constructor(readonly conflicts: CloudImportConflicts) {
    super(
      "Cloud import found existing records with matching IDs. Resolve the conflict before importing.",
    );
  }
}

/** Canonical JSON avoids digest differences caused only by object key order. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function hex(bytes: ArrayBuffer) {
  return Array.from(new Uint8Array(bytes), (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("");
}

/** Collision-resistant digest used by both the client and PostgreSQL RPC. */
export async function snapshotDigest(snapshotJson: string) {
  if (!globalThis.crypto?.subtle) {
    throw new Error("This browser cannot securely prepare a cloud import.");
  }
  const bytes = new TextEncoder().encode(snapshotJson);
  return `sha256:${hex(await globalThis.crypto.subtle.digest("SHA-256", bytes))}`;
}

function snapshotFrom(store: Store): LocalCloudSnapshot {
  return {
    tasks: store.tasks,
    people: store.people,
    quotes: store.quotes,
    timezone: store.timezone,
    workingDays: store.workingDays,
    name: store.name,
    business: store.business,
  };
}

export function importCounts(snapshot: LocalCloudSnapshot): CloudImportCounts {
  return {
    customers: snapshot.people.length,
    interactions: snapshot.people.reduce(
      (total, person) => total + person.interactions.length,
      0,
    ),
    quotes: snapshot.quotes.length,
    quoteStatusChanges: snapshot.quotes.reduce(
      (total, quote) => total + quote.statusHistory.length,
      0,
    ),
    tasks: snapshot.tasks.length,
  };
}

/** Validate local relationships before anything is sent to a cloud provider. */
export async function previewLocalCloudImport(
  store: Store,
): Promise<CloudImportPreview> {
  const snapshot = snapshotFrom(store);
  const snapshotJson = canonicalJson(snapshot);
  const customerIds = new Set(snapshot.people.map((person) => person.id));
  const quoteIds = new Set(snapshot.quotes.map((quote) => quote.id));
  const warnings: string[] = [];
  const errors: string[] = [];
  const duplicates = (ids: string[], kind: string) => {
    if (new Set(ids).size !== ids.length)
      errors.push(`Duplicate ${kind} IDs cannot be imported.`);
  };
  duplicates(
    snapshot.people.map((person) => person.id),
    "customer",
  );
  duplicates(
    snapshot.quotes.map((quote) => quote.id),
    "quote",
  );
  duplicates(
    snapshot.tasks.map((task) => task.id),
    "task",
  );
  for (const quote of snapshot.quotes) {
    if (!customerIds.has(quote.customerId))
      errors.push(`Quote ${quote.id} references a missing customer.`);
  }
  for (const task of snapshot.tasks) {
    if (task.personId && !customerIds.has(task.personId))
      errors.push(`Task ${task.id} references a missing customer.`);
    if (task.quoteId && !quoteIds.has(task.quoteId))
      errors.push(`Task ${task.id} references a missing quote.`);
    if (!task.personId && task.person)
      warnings.push(
        `Task ${task.id} retains its legacy name-only customer link.`,
      );
  }
  return {
    sourceStorageKey: STORAGE_KEY,
    sourceDigest: await snapshotDigest(snapshotJson),
    snapshotJson,
    counts: importCounts(snapshot),
    warnings,
    errors,
    snapshot,
  };
}

function hasConflicts(conflicts: CloudImportConflicts) {
  return Object.values(conflicts).some((ids) => ids.length > 0);
}

function safeFailureReason(error: unknown) {
  if (error instanceof Error && /^[\w .,:;()/-]{1,300}$/.test(error.message))
    return error.message;
  return "The cloud transaction was rejected.";
}

/**
 * Explicitly approved and retry-safe. A network interruption leaves a
 * `prepared` journal entry for retry; a confirmed transaction rejection is
 * recorded as `rolled_back`. Local browser data is never deleted.
 */
export async function importApprovedLocalWorkspace(args: {
  storage: StorageLike;
  workspaceId: string;
  store: Store;
  approved: boolean;
  gateway: LocalImportGateway;
  now?: () => string;
}) {
  if (!args.approved)
    throw new Error("Review and approve the local-data import first.");
  const preview = await previewLocalCloudImport(args.store);
  if (preview.errors.length) throw new Error(preview.errors.join(" "));
  const raw = args.storage.getItem(STORAGE_KEY) ?? JSON.stringify(args.store);
  const backupKey = `${STORAGE_KEY}${BACKUP_SUFFIX}`;
  if (!args.storage.getItem(backupKey)) args.storage.setItem(backupKey, raw);
  const preparation = await args.gateway.prepareImport({
    workspaceId: args.workspaceId,
    sourceDigest: preview.sourceDigest,
    snapshotJson: preview.snapshotJson,
  });
  if (!preparation.ready || hasConflicts(preparation.conflicts)) {
    throw new LocalImportConflictError(preparation.conflicts);
  }
  if (!preparation.importId)
    throw new Error("Cloud import preparation did not return an import ID.");
  const journal: ImportJournal = {
    workspaceId: args.workspaceId,
    sourceDigest: preview.sourceDigest,
    importId: preparation.importId,
    startedAt: (args.now ?? (() => new Date().toISOString()))(),
  };
  args.storage.setItem(
    `${STORAGE_KEY}${JOURNAL_SUFFIX}`,
    JSON.stringify(journal),
  );
  if (preparation.duplicate)
    return {
      preview,
      result: {
        importId: preparation.importId,
        duplicate: true,
        counts: preview.counts,
      },
    };
  try {
    const result = await args.gateway.importPreparedSnapshot({
      workspaceId: args.workspaceId,
      importId: preparation.importId,
      sourceDigest: preview.sourceDigest,
      snapshotJson: preview.snapshotJson,
    });
    if (JSON.stringify(result.counts) !== JSON.stringify(preview.counts)) {
      throw new Error(
        "Cloud import count verification failed. Your local backup is still available.",
      );
    }
    return { preview, result };
  } catch (error) {
    // A gateway only throws a typed provider/database error after a response.
    // Transport failures intentionally remain prepared because their outcome is unknown.
    if (error instanceof ConfirmedCloudTransactionError) {
      await args.gateway.markRolledBack({
        workspaceId: args.workspaceId,
        importId: preparation.importId,
        reason: safeFailureReason(error),
      });
    }
    throw error;
  }
}

/** An RPC response proves the database rolled back; a network failure does not. */
export class ConfirmedCloudTransactionError extends Error {}

/** Safely validates an old browser payload through the existing compatibility migration. */
export function restoreLegacyLocalSnapshot(value: unknown, now?: string) {
  return migrateStore(value, now);
}

export const LOCAL_CLOUD_IMPORT_BACKUP_KEY = `${STORAGE_KEY}${BACKUP_SUFFIX}`;
export const LOCAL_CLOUD_IMPORT_JOURNAL_KEY = `${STORAGE_KEY}${JOURNAL_SUFFIX}`;
