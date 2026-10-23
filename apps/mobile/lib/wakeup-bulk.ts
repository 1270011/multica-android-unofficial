/**
 * Bulk "Turn off" in the workspace wakeup overview. Pure functions, so
 * selection, the sequential run and the partial-success rules are
 * unit-tested without rendering.
 *
 * - Only rows the user may switch off are selectable: no system rows, the
 *   server's `can_manage`, no 403 seen for the row, and the rule is on
 *   (same filter as the web's "Turn off selected").
 * - The requests run one after another, like the web hook
 *   `useDisableWorkspaceWakeups`: bounded load and an exact list of the
 *   rows that failed.
 * - After the run only the failed rows stay selected, so "Turn off" can be
 *   retried; "Cancel" empties the selection.
 */
import type { MobileWorkspaceWakeup } from "@/data/wakeup-schemas";
import { isSystemRow } from "@/lib/wakeup-overview";

type SelectRow = Pick<MobileWorkspaceWakeup, "id" | "enabled" | "can_manage" | "rule" | "source">;
type BulkRow = Pick<MobileWorkspaceWakeup, "id" | "issue_id">;

export function isBulkSelectable(w: SelectRow, forbidden = false): boolean {
  return !isSystemRow(w) && w.can_manage && !forbidden && w.enabled;
}

/** Adds or removes one row; unselectable rows are never added. */
export function toggleSelection(
  selected: ReadonlySet<string>,
  w: SelectRow,
  forbidden = false,
): ReadonlySet<string> {
  const next = new Set(selected);
  if (next.has(w.id)) next.delete(w.id);
  else if (isBulkSelectable(w, forbidden)) next.add(w.id);
  return next;
}

/**
 * Keeps only ids that are still loaded and selectable (after a refetch a
 * switched-off rule leaves the selection). Returns the same set when
 * nothing changed, so React skips the update.
 */
export function pruneSelection(
  selected: ReadonlySet<string>,
  rows: readonly SelectRow[],
  forbidden: ReadonlySet<string> = new Set(),
): ReadonlySet<string> {
  if (selected.size === 0) return selected;
  const keep = new Set(
    rows.filter((r) => selected.has(r.id) && isBulkSelectable(r, forbidden.has(r.id))).map((r) => r.id),
  );
  return keep.size === selected.size ? selected : keep;
}

/** The selected rows in list order (what the confirmation counts). */
export function selectedRows<T extends BulkRow>(rows: readonly T[], selected: ReadonlySet<string>): T[] {
  return rows.filter((r) => selected.has(r.id));
}

export interface BulkDisableResult {
  succeeded: string[];
  failed: string[];
  /** Rows the server answered 403 for; their actions vanish. */
  forbidden: string[];
}

/** Turns the rows off one after another; never throws. */
export async function disableSequentially(
  rows: readonly BulkRow[],
  disable: (issueId: string, wakeupId: string) => Promise<unknown>,
  isForbidden: (err: unknown) => boolean = () => false,
): Promise<BulkDisableResult> {
  const result: BulkDisableResult = { succeeded: [], failed: [], forbidden: [] };
  for (const row of rows) {
    try {
      await disable(row.issue_id, row.id);
      result.succeeded.push(row.id);
    } catch (err) {
      result.failed.push(row.id);
      if (isForbidden(err)) result.forbidden.push(row.id);
    }
  }
  return result;
}

/** Failed rows stay selected for a retry; on full success it is empty. */
export function selectionAfterBulk(result: Pick<BulkDisableResult, "failed">): ReadonlySet<string> {
  return new Set(result.failed);
}

/** Toast after the run: key plus values for `issues:wakeups.bulk.*`. */
export function bulkToast(result: Pick<BulkDisableResult, "succeeded" | "failed">): {
  key: "wakeups.bulk.toast_done" | "wakeups.bulk.toast_partial";
  values: { count: number; ok: number; total: number };
} {
  const ok = result.succeeded.length;
  const total = ok + result.failed.length;
  return {
    key: result.failed.length ? "wakeups.bulk.toast_partial" : "wakeups.bulk.toast_done",
    values: { count: ok, ok, total },
  };
}

export type BulkSelectionAction =
  | { type: "toggle"; row: SelectRow; forbidden?: boolean }
  | { type: "cancel" }
  | { type: "result"; result: Pick<BulkDisableResult, "failed"> }
  | { type: "prune"; rows: readonly SelectRow[]; forbidden?: ReadonlySet<string> };

const EMPTY: ReadonlySet<string> = new Set();

/**
 * Selection state of the overview (`useReducer`). Selection mode is
 * `size > 0`: "Cancel" and a fully successful run end it.
 */
export function bulkSelectionReducer(
  state: ReadonlySet<string>,
  action: BulkSelectionAction,
): ReadonlySet<string> {
  switch (action.type) {
    case "toggle":
      return toggleSelection(state, action.row, action.forbidden);
    case "cancel":
      return state.size === 0 ? state : EMPTY;
    case "result":
      return selectionAfterBulk(action.result);
    case "prune":
      return pruneSelection(state, action.rows, action.forbidden);
  }
}
