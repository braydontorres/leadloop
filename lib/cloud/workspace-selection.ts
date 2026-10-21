import type { CloudWorkspaceSummary } from "./repository";

const SELECTION_PREFIX = "leadloop.cloud-workspace.v1";

type SelectionStorage = Pick<Storage, "getItem" | "removeItem" | "setItem">;

function keyFor(userId: string) {
  return `${SELECTION_PREFIX}.${encodeURIComponent(userId)}`;
}

/** A workspace choice is private to one authenticated user on this browser. */
export function readSelectedCloudWorkspace(
  storage: Pick<SelectionStorage, "getItem">,
  userId: string,
): string | null {
  if (!userId) return null;
  try {
    const workspaceId = storage.getItem(keyFor(userId));
    return workspaceId && workspaceId.trim() ? workspaceId : null;
  } catch {
    return null;
  }
}

export function saveSelectedCloudWorkspace(
  storage: Pick<SelectionStorage, "setItem">,
  userId: string,
  workspaceId: string,
) {
  if (!userId || !workspaceId) return;
  try {
    storage.setItem(keyFor(userId), workspaceId);
  } catch {
    // Storage can be unavailable in private browsing. Cloud access still works.
  }
}

export function clearSelectedCloudWorkspace(
  storage: Pick<SelectionStorage, "removeItem">,
  userId: string,
) {
  if (!userId) return;
  try {
    storage.removeItem(keyFor(userId));
  } catch {
    // A stale local preference cannot affect server authorization.
  }
}

export type WorkspaceRestoreTarget =
  | { kind: "saved"; workspaceId: string }
  | { kind: "only_workspace"; workspaceId: string }
  | { kind: "selection_required" };

/** Never chooses arbitrarily when a user can access more than one workspace. */
export function chooseWorkspaceRestoreTarget(
  workspaces: readonly CloudWorkspaceSummary[],
  savedWorkspaceId: string | null,
): WorkspaceRestoreTarget {
  if (
    savedWorkspaceId &&
    workspaces.some((item) => item.id === savedWorkspaceId)
  ) {
    return { kind: "saved", workspaceId: savedWorkspaceId };
  }
  if (workspaces.length === 1)
    return { kind: "only_workspace", workspaceId: workspaces[0].id };
  return { kind: "selection_required" };
}
