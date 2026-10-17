/**
 * Pure helpers for the issue fields added this change (start date, stage,
 * parent, duplicate). Mirrors packages/views/issues/components/pickers/
 * stage-picker.tsx and the parent/duplicate modals.
 */
import type { Issue, UpdateIssueRequest } from "@multica/core/types";

/** Highest stage among a parent's children (0 when none are staged). */
export function maxSiblingStage(children: readonly { stage: number | null }[]): number {
  return children.reduce((m, c) => (c.stage != null && c.stage > m ? c.stage : m), 0);
}

/** Stage 1..top: covers the current stage, the highest sibling stage and
 *  one beyond it, at least Stage 1–3 (same as web). */
export function stageOptions(stage: number | null, maxStage = 0): number[] {
  const top = Math.max(stage ?? 0, maxStage, 2) + 1;
  return Array.from({ length: top }, (_, i) => i + 1);
}

/** Detaching from the parent also clears the stage — it only orders
 *  siblings, so it would be orphaned on a standalone issue (web does the
 *  same in one write). */
export function removeParentPatch(): UpdateIssueRequest {
  return { parent_issue_id: null, stage: null };
}

/** Setting or changing the parent sends only the link, like web's
 *  set-parent modal (no `stage`). */
export function setParentPatch(parentId: string): UpdateIssueRequest {
  return { parent_issue_id: parentId };
}

/**
 * Parents whose children list a write affects (web: useUpdateIssue
 * onSettled): the old parent for any parent or stage change, plus the new
 * parent when the link moved.
 */
export function affectedParentIds(
  prevParentId: string | null | undefined,
  patch: UpdateIssueRequest,
): string[] {
  const touchesParent = "parent_issue_id" in patch;
  if (!touchesParent && !("stage" in patch)) return [];
  const ids = new Set<string>();
  if (prevParentId) ids.add(prevParentId);
  if (touchesParent && patch.parent_issue_id) ids.add(patch.parent_issue_id);
  return [...ids];
}

/**
 * i18n key (`issues` namespace) for update errors web explains on its own;
 * null means the generic "update_failed".
 */
export function issueUpdateErrorKey(err: unknown): string | null {
  if (!err || typeof err !== "object") return null;
  const { status, body } = err as { status?: unknown; body?: unknown };
  const { code, error } = (body ?? {}) as { code?: unknown; error?: unknown };
  if (status === 409 && code === "duplicate_target_is_duplicate") return "errors.duplicate_target_is_duplicate";
  if (status === 409 && code === "issue_has_duplicates") return "errors.issue_has_duplicates";
  if (status === 400 && typeof error === "string" && /circular parent/i.test(error)) {
    return "errors.circular_parent";
  }
  return null;
}

type Candidate = Pick<Issue, "id" | "parent_issue_id"> & { duplicate_of?: unknown };

/**
 * Parent candidates: never the issue itself, its current parent (no-op) or
 * one of its direct children (an obvious cycle; deeper cycles are rejected
 * by the server with "circular parent relationship").
 */
export function parentCandidates<T extends Candidate>(
  results: readonly T[],
  issue: Pick<Issue, "id" | "parent_issue_id">,
): T[] {
  return results.filter(
    (c) => c.id !== issue.id && c.id !== issue.parent_issue_id && c.parent_issue_id !== issue.id,
  );
}

/** Duplicate originals: not the issue itself and not issues that are
 *  duplicates themselves (web: `isDuplicateIssue`). */
export function duplicateCandidates<T extends Candidate>(results: readonly T[], issueId: string): T[] {
  return results.filter((c) => c.id !== issueId && !c.duplicate_of);
}
