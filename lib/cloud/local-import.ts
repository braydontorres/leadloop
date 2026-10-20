import { STORAGE_KEY, migrateStore, type Store } from "../tasks";
import type {
  CloudImportCounts,
  CloudImportPreview,
  CloudImportResult,
  LocalCloudSnapshot,
} from "./types";

const BACKUP_SUFFIX = ".cloud-import-backup.v1";
const JOURNAL_SUFFIX = ".cloud-import-journal.v1";

type StorageLike = Pick<Storage, "getItem" | "setItem">;

export type LocalImportGateway = {
  importSnapshot(input: {
    workspaceId: string;
    sourceFingerprint: string;
    snapshot: LocalCloudSnapshot;
  }): Promise<CloudImportResult>;
};

export type ImportJournal = {
  workspaceId: string;
  sourceFingerprint: string;
  startedAt: string;
};

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stable(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

/** Deterministic source identity; the server also stores it under a unique workspace constraint. */
export function localSnapshotFingerprint(snapshot: LocalCloudSnapshot) {
  let hash = 2166136261;
  for (const char of stable(snapshot)) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `leadloop-local-v1-${(hash >>> 0).toString(16)}`;
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

/** Validate relations before anything is uploaded; no local data is changed. */
export function previewLocalCloudImport(store: Store): CloudImportPreview {
  const snapshot = snapshotFrom(store);
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
    if (!customerIds.has(quote.customerId)) {
      errors.push(`Quote ${quote.id} references a missing customer.`);
    }
  }
  for (const task of snapshot.tasks) {
    if (task.personId && !customerIds.has(task.personId)) {
      errors.push(`Task ${task.id} references a missing customer.`);
    }
    if (task.quoteId && !quoteIds.has(task.quoteId)) {
      errors.push(`Task ${task.id} references a missing quote.`);
    }
    if (!task.personId && task.person) {
      warnings.push(
        `Task ${task.id} retains its legacy name-only customer link.`,
      );
    }
  }
  return {
    sourceStorageKey: STORAGE_KEY,
    sourceFingerprint: localSnapshotFingerprint(snapshot),
    counts: importCounts(snapshot),
    warnings,
    errors,
    snapshot,
  };
}

/**
 * Explicitly approved, retry-safe import. A local backup and small journal are
 * written first; browser data is never deleted. The gateway must be atomic and
 * idempotent by (workspaceId, sourceFingerprint).
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
  const preview = previewLocalCloudImport(args.store);
  if (preview.errors.length) throw new Error(preview.errors.join(" "));
  const raw = args.storage.getItem(STORAGE_KEY) ?? JSON.stringify(args.store);
  const backupKey = `${STORAGE_KEY}${BACKUP_SUFFIX}`;
  if (!args.storage.getItem(backupKey)) args.storage.setItem(backupKey, raw);
  const journal: ImportJournal = {
    workspaceId: args.workspaceId,
    sourceFingerprint: preview.sourceFingerprint,
    startedAt: (args.now ?? (() => new Date().toISOString()))(),
  };
  args.storage.setItem(
    `${STORAGE_KEY}${JOURNAL_SUFFIX}`,
    JSON.stringify(journal),
  );
  const result = await args.gateway.importSnapshot({
    workspaceId: args.workspaceId,
    sourceFingerprint: preview.sourceFingerprint,
    snapshot: preview.snapshot,
  });
  if (JSON.stringify(result.counts) !== JSON.stringify(preview.counts)) {
    throw new Error(
      "Cloud import count verification failed. Your local backup is still available.",
    );
  }
  return { preview, result };
}

/** Safely validates an old browser payload through the existing compatibility migration. */
export function restoreLegacyLocalSnapshot(value: unknown, now?: string) {
  return migrateStore(value, now);
}

export const LOCAL_CLOUD_IMPORT_BACKUP_KEY = `${STORAGE_KEY}${BACKUP_SUFFIX}`;
export const LOCAL_CLOUD_IMPORT_JOURNAL_KEY = `${STORAGE_KEY}${JOURNAL_SUFFIX}`;
