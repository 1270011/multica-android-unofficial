/**
 * Invitation helpers.
 *
 * The server lists only pending, unexpired invitations
 * (ListPendingInvitationsForUser); the app filters again so a row that
 * expired while the screen was open, or a non-pending row from a drifted
 * payload, never offers Accept.
 */
import type { Invitation, Workspace } from "@multica/core/types";

export function openInvitations(
  invitations: readonly Invitation[],
  now: number = Date.now(),
): Invitation[] {
  return invitations
    .filter((inv) => {
      if (inv.status !== "pending") return false;
      const expires = Date.parse(inv.expires_at);
      return Number.isNaN(expires) || expires > now;
    })
    .sort((a, b) => (Date.parse(b.created_at) || 0) - (Date.parse(a.created_at) || 0));
}

/** The workspace an accepted invitation joined, once it is in the list. */
export function joinedWorkspace(
  workspaces: readonly Workspace[],
  invitation: Pick<Invitation, "workspace_id">,
): Workspace | null {
  return workspaces.find((w) => w.id === invitation.workspace_id) ?? null;
}

/** "Invited by Alice" / by e-mail / nothing, without exposing raw ids. */
export function inviterLabel(inv: Pick<Invitation, "inviter_name" | "inviter_email">): string | null {
  const name = inv.inviter_name?.trim();
  if (name) return name;
  const email = inv.inviter_email?.trim();
  return email || null;
}

/**
 * Accept, then resolve the joined workspace. Only the accept
 * may fail the operation; a failing list read afterwards yields null ("the
 * workspace appears shortly"), never "invitation not available".
 */
export async function acceptAndResolve(
  invitation: Pick<Invitation, "id" | "workspace_id">,
  accept: (id: string) => Promise<void>,
  fetchWorkspaces: () => Promise<readonly Workspace[]>,
): Promise<Workspace | null> {
  try {
    await accept(invitation.id);
  } catch (err) {
    // 409 "already a member": the goal is reached (e.g. accepted on
    // another device a moment ago) — a success, not a failure.
    if (!isAlreadyMember(err)) throw err;
  }
  try {
    return joinedWorkspace(await fetchWorkspaces(), invitation);
  } catch {
    return null;
  }
}

export type InvitationErrorKind = "gone" | "invalid" | "network";

function httpStatus(err: unknown): number | null {
  return err && typeof err === "object" && "status" in err && typeof (err as { status: unknown }).status === "number"
    ? (err as { status: number }).status
    : null;
}

/** Server error text: `{"error": "..."}` (handler writeError) in ApiError.body. */
function serverError(err: unknown): string {
  const body = err && typeof err === "object" && "body" in err ? (err as { body: unknown }).body : undefined;
  const text = body && typeof body === "object" && "error" in body ? (body as { error: unknown }).error : undefined;
  return typeof text === "string" ? text : "";
}

/** 409 "you are already a member of this workspace" (invitation.go). */
export function isAlreadyMember(err: unknown): boolean {
  return httpStatus(err) === 409 && /already a member/i.test(serverError(err));
}

/**
 * Which message an accept/decline failure gets: 404/410 and 400
 * "invitation is not pending" → no longer available (answered elsewhere,
 * revoked, expired); other HTTP errors → could not be processed; no
 * HTTP status → connection problem.
 */
export function invitationErrorKind(err: unknown): InvitationErrorKind {
  const status = httpStatus(err);
  if (status === null) return "network";
  if (status === 404 || status === 410) return "gone";
  if (status === 400 && /not pending/i.test(serverError(err))) return "gone";
  return "invalid";
}
