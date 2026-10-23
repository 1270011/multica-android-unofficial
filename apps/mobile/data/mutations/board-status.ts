/**
 * Status change from the board via the card menu: `POST /api/issues/{id}/move` without
 * neighbour ids — the server keeps the card's position, so Undo restores
 * the position too. `useMoveIssue` patches the caches optimistically and
 * rolls back with an error toast. On success a toast "Moved to <status> ·
 * Undo" offers the reverse move.
 *
 * The toast hangs on `mutateAsync`, not on `mutate(…, { onSuccess })`: the
 * status sheet closes right after the pick, and TanStack Query skips
 * per-call callbacks of an unmounted observer.
 *
 * Neighbour ids only ever go out with the sort "Manual"
 * (`boardMoveNeighbours`); with any other sort a drop sends the status only.
 */
import type { IssueStatus, MoveIssueRequest } from "@multica/core/types";
import { useMoveIssue } from "@/data/mutations/issue-move-batch";
import { showToast } from "@/lib/toast";
import { actionToastDuration } from "@/lib/toast-a11y";
import { boardMoveNeighbours, type IssueListSort, MANUAL_SORT } from "@/lib/issue-list-sort";

export function statusMoveBody(
  status: IssueStatus,
  sort: IssueListSort = MANUAL_SORT,
  neighbours?: { before_id?: string | null; after_id?: string | null },
): MoveIssueRequest {
  return { status, ...boardMoveNeighbours(sort, neighbours) };
}

/**
 * Returns `change(issueId, from, to, label)`; `label` is the target
 * status' display name for the toast text.
 */
export function useBoardStatusChange(
  movedText: (label: string) => string,
  sort: IssueListSort = MANUAL_SORT,
) {
  const move = useMoveIssue();
  return async (issueId: string, from: IssueStatus, to: IssueStatus, label: string): Promise<void> => {
    if (from === to) return;
    try {
      await move.mutateAsync({ issueId, body: statusMoveBody(to, sort) });
    } catch {
      return; // useMoveIssue rolled back and showed the error toast
    }
    showToast(movedText(label), await actionToastDuration(), {
      label: { key: "issues:board.undo" },
      onPress: () => move.mutate({ issueId, body: statusMoveBody(from, sort) }),
    });
  };
}
