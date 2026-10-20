import assert from "node:assert/strict";
import test from "node:test";
import {
  canAccessWorkspace,
  requireWorkspaceAccess,
} from "../lib/cloud/workspace-access";
import {
  importApprovedLocalWorkspace,
  LOCAL_CLOUD_IMPORT_BACKUP_KEY,
  localSnapshotFingerprint,
  previewLocalCloudImport,
  restoreLegacyLocalSnapshot,
  type LocalImportGateway,
} from "../lib/cloud/local-import";
import { sampleStore, STORAGE_KEY, type Store } from "../lib/tasks";
import type { CloudImportResult } from "../lib/cloud/types";

class MemoryStorage {
  values = new Map<string, string>();
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

function fixture(): Store {
  const store = sampleStore();
  const mike = {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Mike",
    business: "",
    email: "",
    phone: "",
    address: "",
    notes: "Driveway estimate",
    interactions: [
      {
        id: "22222222-2222-4222-8222-222222222222",
        note: "Asked for quote",
        createdAt: "2026-10-20T12:00:00.000Z",
      },
    ],
    createdAt: "2026-10-20T12:00:00.000Z",
    updatedAt: "2026-10-20T12:00:00.000Z",
  };
  const quote = {
    id: "33333333-3333-4333-8333-333333333333",
    customerId: mike.id,
    serviceDescription: "Driveway cleaning",
    amountCents: 25000,
    currency: "USD" as const,
    status: "draft" as const,
    notes: "",
    createdAt: "2026-10-20T12:00:00.000Z",
    updatedAt: "2026-10-20T12:00:00.000Z",
    statusHistory: [],
  };
  return {
    ...store,
    people: [mike],
    quotes: [quote],
    tasks: [
      {
        id: "44444444-4444-4444-8444-444444444444",
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

function gateway(result: CloudImportResult): LocalImportGateway {
  return { importSnapshot: async () => result };
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

test("preview preserves IDs and customer/quote/task relationships", () => {
  const preview = previewLocalCloudImport(fixture());
  assert.deepEqual(preview.errors, []);
  assert.equal(preview.counts.customers, 1);
  assert.equal(preview.counts.quotes, 1);
  assert.equal(preview.counts.tasks, 1);
  assert.equal(
    preview.snapshot.tasks[0].personId,
    preview.snapshot.people[0].id,
  );
  assert.equal(
    preview.snapshot.tasks[0].quoteId,
    preview.snapshot.quotes[0].id,
  );
  assert.equal(
    localSnapshotFingerprint(preview.snapshot),
    preview.sourceFingerprint,
  );
});

test("preview rejects broken links before cloud upload", () => {
  const store = fixture();
  store.tasks[0].quoteId = "missing";
  assert.match(
    previewLocalCloudImport(store).errors.join(" "),
    /missing quote/,
  );
});

test("approved import backs up local data and verifies returned counts", async () => {
  const store = fixture();
  const storage = new MemoryStorage();
  storage.setItem(STORAGE_KEY, JSON.stringify(store));
  const preview = previewLocalCloudImport(store);
  const outcome = await importApprovedLocalWorkspace({
    storage,
    workspaceId: "workspace-a",
    store,
    approved: true,
    gateway: gateway({
      importId: "i1",
      duplicate: false,
      counts: preview.counts,
    }),
    now: () => "2026-10-20T12:00:00.000Z",
  });
  assert.equal(outcome.result.importId, "i1");
  assert.equal(
    storage.getItem(LOCAL_CLOUD_IMPORT_BACKUP_KEY),
    JSON.stringify(store),
  );
  assert.equal(storage.getItem(STORAGE_KEY), JSON.stringify(store));
});

test("unapproved, duplicate, and failed imports do not delete browser data", async () => {
  const store = fixture();
  const storage = new MemoryStorage();
  storage.setItem(STORAGE_KEY, JSON.stringify(store));
  await assert.rejects(() =>
    importApprovedLocalWorkspace({
      storage,
      workspaceId: "w",
      store,
      approved: false,
      gateway: gateway({
        importId: "x",
        duplicate: false,
        counts: previewLocalCloudImport(store).counts,
      }),
    }),
  );
  const preview = previewLocalCloudImport(store);
  const duplicate = await importApprovedLocalWorkspace({
    storage,
    workspaceId: "w",
    store,
    approved: true,
    gateway: gateway({
      importId: "i2",
      duplicate: true,
      counts: preview.counts,
    }),
  });
  assert.equal(duplicate.result.duplicate, true);
  await assert.rejects(() =>
    importApprovedLocalWorkspace({
      storage,
      workspaceId: "w",
      store,
      approved: true,
      gateway: {
        importSnapshot: async () => {
          throw new Error("network interrupted");
        },
      },
    }),
  );
  assert.equal(storage.getItem(STORAGE_KEY), JSON.stringify(store));
  assert.ok(storage.getItem(LOCAL_CLOUD_IMPORT_BACKUP_KEY));
});

test("legacy browser payload still migrates without reset", () => {
  const old = {
    tasks: [],
    people: [],
    timezone: "America/Chicago",
    name: "Alex",
    business: "",
    workingDays: [1, 2, 3, 4, 5],
  };
  const restored = restoreLegacyLocalSnapshot(old, "2026-10-20T12:00:00.000Z");
  assert.deepEqual(restored.quotes, []);
  assert.equal(restored.timezone, "America/Chicago");
  // Existing prototype data includes non-UUID IDs such as p1 and sample-1.
  const legacyPreview = previewLocalCloudImport(sampleStore());
  assert.deepEqual(legacyPreview.errors, []);
  assert.equal(legacyPreview.snapshot.people[0].id, "p1");
});
