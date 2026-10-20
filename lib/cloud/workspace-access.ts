import type { WorkspaceMember } from "./types";

/** A small shared guard for test doubles and non-SQL callers. PostgreSQL RLS is authoritative. */
export function canAccessWorkspace(
  memberships: readonly WorkspaceMember[],
  userId: string | null | undefined,
  workspaceId: string,
) {
  return Boolean(
    userId &&
    memberships.some(
      (member) =>
        member.userId === userId && member.workspaceId === workspaceId,
    ),
  );
}

export function requireWorkspaceAccess(
  memberships: readonly WorkspaceMember[],
  userId: string | null | undefined,
  workspaceId: string,
) {
  if (!canAccessWorkspace(memberships, userId, workspaceId)) {
    throw new Error("You do not have access to this workspace.");
  }
}
