/**
 * Pure helpers of the issue-list batch actions: which field a running batch update
 * changes, when the action bar shows icons only, the value the selected
 * issues share in a picker, and the texts of batch delete (D7).
 */
import type { QueryClient } from "@tanstack/react-query";
import type { Issue, UpdateIssueRequest } from "@multica/core/types";
import { issueKeys } from "@/data/queries/issue-keys";

export type BatchField = "status" | "priority" | "assignee";
/** A button of the selection action bar: a batch field or delete (D7). */
export type BatchAction = BatchField | "delete";

/** Icons only when labels would not fit: large font or a narrow screen. */
export function selectionActionsIconsOnly(width: number, fontScale: number): boolean {
  return fontScale >= 2 || width < 360;
}

/** Which field the running batch update changes, if one runs. */
export function batchFieldOf(variables: { updates?: UpdateIssueRequest } | undefined): BatchField | null {
  const updates = variables?.updates;
  if (!updates) return null;
  if (updates.status !== undefined) return "status";
  if (updates.priority !== undefined) return "priority";
  if (updates.assignee_id !== undefined || updates.assignee_type !== undefined) return "assignee";
  return null;
}

/** The value every issue shares, or null when they differ or none is given. */
export function commonValue<T>(issues: readonly Issue[], pick: (issue: Issue) => T): T | null {
  if (issues.length === 0) return null;
  const first = pick(issues[0]!);
  return issues.every((issue) => pick(issue) === first) ? first : null;
}

/** Selected issues as the list caches hold them (first hit per id). */
export function selectedIssuesFromCache(
  qc: QueryClient,
  wsId: string | null,
  ids: readonly string[],
): Issue[] {
  const byId = new Map<string, Issue>();
  for (const prefix of [issueKeys.myAll(wsId), issueKeys.list(wsId)]) {
    for (const [, list] of qc.getQueriesData<Issue[]>({ queryKey: prefix })) {
      if (!Array.isArray(list)) continue;
      for (const issue of list) if (!byId.has(issue.id)) byId.set(issue.id, issue);
    }
  }
  return ids.flatMap((id) => {
    const issue = byId.get(id);
    return issue ? [issue] : [];
  });
}


type Translate = (key: string, params?: Record<string, unknown>) => string;

/**
 * Confirmation before batch delete, worded as in spec §3: "3 Issues
 * löschen?" / "Das lässt sich nicht rückgängig machen. Laufende
 * Agent-Läufe werden abgebrochen." with "Abbrechen" / "Löschen".
 */
export function batchDeleteDialog(t: Translate, count: number) {
  return {
    title: t("issues:selection.delete_title", { count }),
    message: t("issues:selection.delete_message", { count }),
    cancel: t("common:actions.cancel"),
    confirm: t("common:actions.delete"),
  };
}

interface AlertButton {
  text: string;
  style: "cancel" | "destructive";
  onPress?: () => void;
}
/** `Alert.alert` from react-native, passed in so this stays testable in node. */
export type AlertFn = (title: string, message: string, buttons: AlertButton[]) => void;

/**
 * Ask before deleting these issues; only "Löschen" calls `onConfirm`.
 * "Abbrechen" (or dismissing the dialog) does nothing at all.
 */
export function confirmBatchDelete(
  alert: AlertFn,
  t: Translate,
  ids: readonly string[],
  onConfirm: (ids: string[]) => void,
): void {
  if (ids.length === 0) return;
  const dialog = batchDeleteDialog(t, ids.length);
  const chosen = [...ids];
  alert(dialog.title, dialog.message, [
    { text: dialog.cancel, style: "cancel" },
    { text: dialog.confirm, style: "destructive", onPress: () => onConfirm(chosen) },
  ]);
}
