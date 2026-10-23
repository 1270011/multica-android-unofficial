/**
 * Board move + multi-select batch writes. Mirrors the
 * endpoints behind packages/core/issues/mutations.ts `useMoveIssue` /
 * `useBatchUpdateIssues` / `useBatchDeleteIssues`, on mobile's flat caches.
 *
 * - Move: predictable field patch (status/assignee/parent/project) → merge
 *   into detail and flat list caches optimistically, roll back on error.
 *   Position is server-owned, so lists are re-read on settle.
 * - Batch update: the same
 *   field patch on every selected row, rolled back on error. The server
 *   skips unfit issues silently and only reports `{updated: n}`; when n is
 *   short we cannot tell which ones, so the patch is rolled back and the
 *   lists re-read. Success or partial success ends the selection, an error
 *   keeps it for another try. No undo in wave 1 (spec F4).
 * - Batch delete: no optimism (deletes must await the server —
 *   root optimistic policy), rows go only after the answer. The server
 *   skips issues it cannot find and reports `{deleted: n}`; when n is short
 *   the lists are re-read and the issues that are still there stay
 *   selected. An error changes nothing and keeps the selection.
 */
import {
  useMutation,
  useQueryClient,
  type MutationKey,
  type QueryClient,
} from "@tanstack/react-query";
import type {
  Issue,
  MoveIssueRequest,
  UpdateIssueRequest,
} from "@multica/core/types";
import { api } from "@/data/api";
import { issueKeys } from "@/data/queries/issues";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useIssueSelectionStore } from "@/data/stores/issue-selection-store";
import { selectedIssuesFromCache } from "@/lib/issue-batch";
import { showToast, type ToastMessage } from "@/lib/toast";
import { isBuiltInIssueStatus, statusCategoryOfKey } from "@/lib/issue-status";

/** Fields of an update that can be applied locally without the server. */
export function fieldsPatch(fields: UpdateIssueRequest): Partial<Issue> {
  const patch: Partial<Issue> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) (patch as Record<string, unknown>)[key] = value;
  }
  if (fields.status !== undefined) {
    patch.status_category = isBuiltInIssueStatus(fields.status)
      ? statusCategoryOfKey(fields.status)
      : undefined;
  }
  return patch;
}

/** Fields of a move that can be applied locally without the server. */
export function movePatch(body: MoveIssueRequest): Partial<Issue> {
  const { before_id: _before, after_id: _after, ...fields } = body;
  return fieldsPatch(fields);
}

/** Patch one issue inside a flat `Issue[]` cache; untouched lists keep identity. */
export function patchIssueInList(
  list: Issue[] | undefined,
  issueId: string,
  patch: Partial<Issue>,
): Issue[] | undefined {
  if (!list?.some((issue) => issue.id === issueId)) return list;
  return list.map((issue) => (issue.id === issueId ? { ...issue, ...patch } : issue));
}

type Snapshot = [readonly unknown[], unknown][];

function snapshotIssueCaches(
  qc: QueryClient,
  wsId: string | null,
  issueIds: readonly string[],
): Snapshot {
  const snapshot: Snapshot = [];
  for (const issueId of issueIds) {
    const detailKey = issueKeys.detail(wsId, issueId);
    snapshot.push([detailKey, qc.getQueryData(detailKey)]);
  }
  for (const prefix of [issueKeys.list(wsId), issueKeys.myAll(wsId)]) {
    for (const [key, data] of qc.getQueriesData<Issue[]>({ queryKey: prefix })) {
      snapshot.push([key, data]);
    }
  }
  return snapshot;
}

function restoreSnapshot(qc: QueryClient, snapshot: Snapshot | undefined): void {
  for (const [key, data] of snapshot ?? []) qc.setQueryData(key, data);
}

/** Apply one patch to these issues in detail and flat list caches. */
function patchIssueCaches(
  qc: QueryClient,
  wsId: string | null,
  issueIds: readonly string[],
  patch: Partial<Issue>,
): void {
  for (const issueId of issueIds) {
    qc.setQueryData<Issue>(issueKeys.detail(wsId, issueId), (prev) =>
      prev ? { ...prev, ...patch } : prev,
    );
  }
  for (const prefix of [issueKeys.list(wsId), issueKeys.myAll(wsId)]) {
    qc.setQueriesData<Issue[]>({ queryKey: prefix }, (list) =>
      issueIds.reduce((acc, issueId) => patchIssueInList(acc, issueId, patch), list),
    );
  }
}

export function useMoveIssue() {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);

  return useMutation({
    mutationFn: ({ issueId, body }: { issueId: string; body: MoveIssueRequest }) =>
      api.moveIssue(issueId, body),
    onMutate: async ({ issueId, body }) => {
      // Only the caches we patch and refetch below; cancelling all of
      // issueKeys.all would leave timeline/children fetches aborted.
      await Promise.all([
        qc.cancelQueries({ queryKey: issueKeys.detail(wsId, issueId) }),
        qc.cancelQueries({ queryKey: issueKeys.list(wsId) }),
        qc.cancelQueries({ queryKey: issueKeys.myAll(wsId) }),
      ]);
      const snapshot = snapshotIssueCaches(qc, wsId, [issueId]);
      patchIssueCaches(qc, wsId, [issueId], movePatch(body));
      return { snapshot };
    },
    onError: (_err, _vars, ctx) => {
      restoreSnapshot(qc, ctx?.snapshot);
      showToast({ key: "issues:errors.update_failed" });
    },
    onSettled: (_data, _err, { issueId }) => {
      qc.invalidateQueries({ queryKey: issueKeys.detail(wsId, issueId) });
      qc.invalidateQueries({ queryKey: issueKeys.list(wsId) });
      qc.invalidateQueries({ queryKey: issueKeys.myAll(wsId) });
    },
  });
}

/** Lets the selection bar find the running batch update (disable + spinner). */
export const BATCH_UPDATE_MUTATION_KEY: MutationKey = ["issues", "batch-update"];

export interface BatchUpdateVariables {
  issueIds: string[];
  updates: UpdateIssueRequest;
}

/** Toast after the server answered: all changed, or "2 of 3 changed". */
export function batchUpdateToast(requested: number, updated: number): ToastMessage {
  return updated >= requested
    ? { key: "issues:selection.updated", params: { count: updated } }
    : { key: "issues:selection.updated_partial", params: { count: updated, total: requested } };
}

export function useBatchUpdateIssues() {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);

  // Lifecycle in the hook options, not in mutate() callbacks: the picker
  // that starts it closes right away, and only these run after unmount.
  return useMutation({
    mutationKey: BATCH_UPDATE_MUTATION_KEY,
    mutationFn: ({ issueIds, updates }: BatchUpdateVariables) =>
      api.batchUpdateIssues(issueIds, updates),
    onMutate: async ({ issueIds, updates }) => {
      await Promise.all([
        ...issueIds.map((id) => qc.cancelQueries({ queryKey: issueKeys.detail(wsId, id) })),
        qc.cancelQueries({ queryKey: issueKeys.list(wsId) }),
        qc.cancelQueries({ queryKey: issueKeys.myAll(wsId) }),
      ]);
      const snapshot = snapshotIssueCaches(qc, wsId, issueIds);
      patchIssueCaches(qc, wsId, issueIds, fieldsPatch(updates));
      return { snapshot };
    },
    onSuccess: ({ updated }, { issueIds }, ctx) => {
      // Skipped rows are unknown: undo all, the refetch below brings the truth.
      if (updated < issueIds.length) restoreSnapshot(qc, ctx?.snapshot);
      showToast(batchUpdateToast(issueIds.length, updated));
      useIssueSelectionStore.getState().reset();
    },
    onError: (err, _vars, ctx) => {
      restoreSnapshot(qc, ctx?.snapshot);
      showToast({
        key: "issues:selection.update_failed",
        params: { message: err instanceof Error ? err.message : String(err) },
      });
    },
    onSettled: () => {
      // Every touched row may sit in any list/detail/children cache.
      qc.invalidateQueries({ queryKey: issueKeys.all(wsId) });
    },
  });
}

/** Lets the selection bar find the running batch delete (disable + spinner). */
export const BATCH_DELETE_MUTATION_KEY: MutationKey = ["issues", "batch-delete"];

/** Toast after the server answered: all deleted, or "2 of 3 deleted". */
export function batchDeleteToast(requested: number, deleted: number): ToastMessage {
  return deleted >= requested
    ? { key: "issues:selection.deleted", params: { count: deleted } }
    : { key: "issues:selection.deleted_partial", params: { count: deleted, total: requested } };
}

/** Drop these issues from detail and flat list caches (after the server said so). */
function removeIssuesFromCaches(
  qc: QueryClient,
  wsId: string | null,
  issueIds: readonly string[],
): void {
  const gone = new Set(issueIds);
  for (const id of issueIds) qc.removeQueries({ queryKey: issueKeys.detail(wsId, id) });
  for (const prefix of [issueKeys.list(wsId), issueKeys.myAll(wsId)]) {
    qc.setQueriesData<Issue[]>({ queryKey: prefix }, (list) =>
      Array.isArray(list) && list.some((issue) => gone.has(issue.id))
        ? list.filter((issue) => !gone.has(issue.id))
        : list,
    );
  }
}

export function useBatchDeleteIssues() {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);

  // Lifecycle in the hook options (see useBatchUpdateIssues): the action
  // bar unmounts when the selection ends.
  return useMutation({
    mutationKey: BATCH_DELETE_MUTATION_KEY,
    mutationFn: (issueIds: string[]) => api.batchDeleteIssues(issueIds),
    onSuccess: async ({ deleted }, issueIds) => {
      if (deleted >= issueIds.length) {
        removeIssuesFromCaches(qc, wsId, issueIds);
        showToast(batchDeleteToast(issueIds.length, deleted));
        useIssueSelectionStore.getState().reset();
        return;
      }
      // Which ones the server skipped is unknown: re-read the lists and keep
      // the issues that are still there selected (the bar stays busy meanwhile).
      await Promise.all([
        qc.refetchQueries({ queryKey: issueKeys.list(wsId) }),
        qc.refetchQueries({ queryKey: issueKeys.myAll(wsId) }),
      ]);
      const left = new Set(selectedIssuesFromCache(qc, wsId, issueIds).map((i) => i.id));
      for (const id of issueIds) {
        if (!left.has(id)) qc.removeQueries({ queryKey: issueKeys.detail(wsId, id) });
      }
      useIssueSelectionStore.getState().prune([...left]);
      showToast(batchDeleteToast(issueIds.length, deleted));
    },
    onError: (err) => {
      showToast({
        key: "issues:selection.delete_failed",
        params: { message: err instanceof Error ? err.message : String(err) },
      });
    },
    onSettled: () => {
      // Deleted parents detach children; other caches may hold the rows too.
      qc.invalidateQueries({ queryKey: issueKeys.all(wsId) });
    },
  });
}
