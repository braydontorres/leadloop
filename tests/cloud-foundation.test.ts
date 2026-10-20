import assert from "node:assert/strict";
import test from "node:test";
import {
  ConfirmedCloudTransactionError,
  importApprovedLocalWorkspace,
  LOCAL_CLOUD_IMPORT_BACKUP_KEY,
  LocalImportConflictError,
  previewLocalCloudImport,
  restoreLegacyLocalSnapshot,
  snapshotDigest,
  type LocalImportGateway,
} from "../lib/cloud/local-import";
import {
  canAccessWorkspace,
  requireWorkspaceAccess,
} from "../lib/cloud/workspace-access";
import { sampleStore, STORAGE_KEY, type Store } from "../lib/tasks";
import type {
  CloudImportConflicts,
  CloudImportCounts,
} from "../lib/cloud/types";

class MemoryStorage {
  values = new Map<string, string>();
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

const noConflicts: CloudImportConflicts = {
  customers: [],
  interactions: [],
  quotes: [],
  quoteStatusChanges: [],
  tasks: [],
};

function fixture(): Store {
  const store = sampleStore();
  const mike = {
    id: "mike",
    name: "Mike",
    business: "",
    email: "",
    phone: "",
    address: "",
    notes: "Driveway estimate",
    interactions: [
      {
        id: "mike-note",
        note: "Asked for quote",
        createdAt: "2026-10-20T12:00:00.000Z",
      },
    ],
    createdAt: "2026-10-20T12:00:00.000Z",
    updatedAt: "2026-10-20T12:00:00.000Z",
  };
  const quote = {
    id: "mike-quote",
    customerId: mike.id,
    serviceDescription: "Driveway cleaning",
    amountCents: 25000,
    currency: "USD" as const,
    status: "draft" as const,
    notes: "",
    createdAt: mike.createdAt,
    updatedAt: mike.updatedAt,
    statusHistory: [],
  };
  return {
    ...store,
    people: [mike],
    quotes: [quote],
    tasks: [
      {
        id: "mike-task",
        title: "Call Mike",
        person: "Mike",
        personId: mike.id,
        quoteId: quote.id,
        due: "2026-10-21T20:00:00.000Z",
        completed: false,
        notes: "",
      },
    ],
  };
}

function gateway(
  counts: CloudImportCounts,
  overrides: Partial<LocalImportGateway> = {},
): LocalImportGateway {
  return {
    prepareImport: async () => ({
      importId: "i1",
      duplicate: false,
      ready: true,
      conflicts: noConflicts,
    }),
    importPreparedSnapshot: async () => ({
      importId: "i1",
      duplicate: false,
      counts,
    }),
    markRolledBack: async () => undefined,
    ...overrides,
  };
}

test("workspace guard prevents cross-tenant access", () => {
  const memberships = [
    { workspaceId: "a", userId: "owner", role: "owner" as const },
  ];
  assert.equal(canAccessWorkspace(memberships, "owner", "a"), true);
  assert.equal(canAccessWorkspace(memberships, "intruder", "a"), false);
  assert.equal(canAccessWorkspace(memberships, "owner", "b"), false);
  assert.throws(() => requireWorkspaceAccess(memberships, "intruder", "a"));
});

test("canonical SHA-256 digest changes with a changed snapshot and has no short fallback", async () => {
  const first = await previewLocalCloudImport(fixture());
  const secondStore = fixture();
  secondStore.tasks[0].title = "Call Mike later";
  const second = await previewLocalCloudImport(secondStore);
  assert.match(first.sourceDigest, /^sha256:[a-f0-9]{64}$/);
  assert.notEqual(first.sourceDigest, second.sourceDigest);
  assert.equal(first.sourceDigest, await snapshotDigest(first.snapshotJson));
});

test("preview preserves IDs and customer/quote/task relationships", async () => {
  const preview = await previewLocalCloudImport(fixture());
  assert.deepEqual(preview.errors, []);
  assert.equal(preview.counts.customers, 1);
  assert.equal(
    preview.snapshot.tasks[0].personId,
    preview.snapshot.people[0].id,
  );
  assert.equal(
    preview.snapshot.tasks[0].quoteId,
    preview.snapshot.quotes[0].id,
  );
});

test("preview rejects broken links before cloud upload", async () => {
  const store = fixture();
  store.tasks[0].quoteId = "missing";
  assert.match(
    (await previewLocalCloudImport(store)).errors.join(" "),
    /missing quote/,
  );
});

test("approved import backs up local data and verifies database counts", async () => {
  const store = fixture();
  const storage = new MemoryStorage();
  storage.setItem(STORAGE_KEY, JSON.stringify(store));
  const preview = await previewLocalCloudImport(store);
  const outcome = await importApprovedLocalWorkspace({
    storage,
    workspaceId: "workspace-a",
    store,
    approved: true,
    gateway: gateway(preview.counts),
    now: () => "2026-10-20T12:00:00.000Z",
  });
  assert.equal(outcome.result.importId, "i1");
  assert.equal(
    storage.getItem(LOCAL_CLOUD_IMPORT_BACKUP_KEY),
    JSON.stringify(store),
  );
  assert.equal(storage.getItem(STORAGE_KEY), JSON.stringify(store));
});

test("conflicts are explicit and never overwrite a matching cloud ID", async () => {
  const store = fixture();
  const storage = new MemoryStorage();
  const preview = await previewLocalCloudImport(store);
  await assert.rejects(
    () =>
      importApprovedLocalWorkspace({
        storage,
        workspaceId: "w",
        store,
        approved: true,
        gateway: gateway(preview.counts, {
          prepareImport: async () => ({
            importId: null,
            duplicate: false,
            ready: false,
            conflicts: { ...noConflicts, tasks: ["mike-task"] },
          }),
        }),
      }),
    LocalImportConflictError,
  );
  assert.equal(storage.getItem(STORAGE_KEY), null);
});

test("database rejection is marked rolled back but an interrupted request stays prepared", async () => {
  const store = fixture();
  const preview = await previewLocalCloudImport(store);
  const storage = new MemoryStorage();
  let marked = 0;
  await assert.rejects(() =>
    importApprovedLocalWorkspace({
      storage,
      workspaceId: "w",
      store,
      approved: true,
      gateway: gateway(preview.counts, {
        importPreparedSnapshot: async () => {
          throw new ConfirmedCloudTransactionError("P0001: relation failed");
        },
        markRolledBack: async () => {
          marked += 1;
        },
      }),
    }),
  );
  assert.equal(marked, 1);
  await assert.rejects(() =>
    importApprovedLocalWorkspace({
      storage,
      workspaceId: "w",
      store,
      approved: true,
      gateway: gateway(preview.counts, {
        importPreparedSnapshot: async () => {
          throw new TypeError("fetch failed");
        },
        markRolledBack: async () => {
          marked += 1;
        },
      }),
    }),
  );
  assert.equal(marked, 1);
  assert.ok(storage.getItem(LOCAL_CLOUD_IMPORT_BACKUP_KEY));
});

test("legacy browser payload and non-UUID local IDs migrate without reset", async () => {
  const old = {
    tasks: [],
    people: [],
    timezone: "America/Chicago",
    name: "Alex",
    business: "",
    workingDays: [1, 2, 3, 4, 5],
  };
  assert.deepEqual(
    restoreLegacyLocalSnapshot(old, "2026-10-20T12:00:00.000Z").quotes,
    [],
  );
  const legacyPreview = await previewLocalCloudImport(sampleStore());
  assert.deepEqual(legacyPreview.errors, []);
  assert.equal(legacyPreview.snapshot.people[0].id, "p1");
});

test("completed digest is idempotent and does not upload a second snapshot", async () => {
  const store = fixture();
  const storage = new MemoryStorage();
  const preview = await previewLocalCloudImport(store);
  let uploads = 0;
  const result = await importApprovedLocalWorkspace({
    storage,
    workspaceId: "w",
    store,
    approved: true,
    gateway: gateway(preview.counts, {
      prepareImport: async () => ({
        importId: "completed-import",
        duplicate: true,
        ready: true,
        conflicts: noConflicts,
        counts: preview.counts,
      }),
      importPreparedSnapshot: async () => {
        uploads += 1;
        return {
          importId: "completed-import",
          duplicate: true,
          counts: preview.counts,
        };
      },
    }),
  });
  assert.equal(result.result.duplicate, true);
  assert.equal(uploads, 0);
});
