import type { Person, Store, Task } from "../tasks";
import type { Quote } from "../quotes";

/** Cloud records deliberately retain the stable IDs already assigned locally. */
export type CloudWorkspace = { id: string; name: string; ownerUserId: string };
export type WorkspaceMember = {
  workspaceId: string;
  userId: string;
  role: "owner" | "member";
};

export type LocalCloudSnapshot = Pick<
  Store,
  | "tasks"
  | "people"
  | "quotes"
  | "timezone"
  | "workingDays"
  | "name"
  | "business"
>;

export type CloudImportCounts = {
  customers: number;
  interactions: number;
  quotes: number;
  quoteStatusChanges: number;
  tasks: number;
};

export type CloudImportPreview = {
  sourceStorageKey: string;
  sourceFingerprint: string;
  counts: CloudImportCounts;
  warnings: string[];
  errors: string[];
  snapshot: LocalCloudSnapshot;
};

export type CloudImportResult = {
  importId: string;
  duplicate: boolean;
  counts: CloudImportCounts;
};

export type CloudTask = Task & { workspaceId: string };
export type CloudCustomer = Person & { workspaceId: string };
export type CloudQuote = Quote & { workspaceId: string };
