/**
 * Board move + multi-select batch writes (UX §6 C/C2/J). Mirrors the
 * endpoints behind packages/core/issues/mutations.ts `useMoveIssue` /
 * `useBatchUpdateIssues` / `useBatchDeleteIssues`, on mobile's flat caches.
 *
 * - Move: predictable field patch (status/assignee/parent/project) → merge
 *   into detail and flat list caches optimistically, roll back on error.
 *   Position is server-owned, so lists are re-read on settle.
 * - Batch update/delete: no optimism (count of affected rows is unknown up
 *   front, and deletes must await the server — root optimistic policy).
 */
import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import type {
  Issue,
  MoveIssueRequest,
  UpdateIssueRequest,
} from "@multica/core/types";
import { api } from "@/data/api";
import { issueKeys } from "@/data/queries/issues";
import { useWorkspaceStore } from "@/data/workspace-store";
import { showToast } from "@/lib/toast";
import { isBuiltInIssueStatus, statusCategoryOfKey } from "@/lib/issue-status";

/** Fields of a move that can be applied locally without the server. */
export function movePatch(body: MoveIssueRequest): Partial<Issue> {
  const { before_id: _before, after_id: _after, ...fields } = body;
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

function snapshotIssueCaches(qc: QueryClient, wsId: string | null, issueId: string): Snapshot {
  const snapshot: Snapshot = [];
  const detailKey = issueKeys.detail(wsId, issueId);
  snapshot.push([detailKey, qc.getQueryData(detailKey)]);
  for (const prefix of [issueKeys.list(wsId), issueKeys.myAll(wsId)]) {
    for (const [key, data] of qc.getQueriesData<Issue[]>({ queryKey: prefix })) {
      snapshot.push([key, data]);
    }
  }
  return snapshot;
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
      const snapshot = snapshotIssueCaches(qc, wsId, issueId);
      const patch = movePatch(body);
      qc.setQueryData<Issue>(issueKeys.detail(wsId, issueId), (prev) =>
        prev ? { ...prev, ...patch } : prev,
      );
      for (const prefix of [issueKeys.list(wsId), issueKeys.myAll(wsId)]) {
        qc.setQueriesData<Issue[]>({ queryKey: prefix }, (list) =>
          patchIssueInList(list, issueId, patch),
        );
      }
      return { snapshot };
    },
    onError: (_err, _vars, ctx) => {
      for (const [key, data] of ctx?.snapshot ?? []) qc.setQueryData(key, data);
      showToast({ key: "issues:errors.update_failed" });
    },
    onSettled: (_data, _err, { issueId }) => {
      qc.invalidateQueries({ queryKey: issueKeys.detail(wsId, issueId) });
      qc.invalidateQueries({ queryKey: issueKeys.list(wsId) });
      qc.invalidateQueries({ queryKey: issueKeys.myAll(wsId) });
    },
  });
}

export function useBatchUpdateIssues() {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);

  return useMutation({
    mutationFn: ({ issueIds, updates }: { issueIds: string[]; updates: UpdateIssueRequest }) =>
      api.batchUpdateIssues(issueIds, updates),
    onError: () => showToast({ key: "issues:errors.update_failed" }),
    onSettled: () => {
      // Every touched row may sit in any list/detail/children cache.
      qc.invalidateQueries({ queryKey: issueKeys.all(wsId) });
    },
  });
}

export function useBatchDeleteIssues() {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);

  return useMutation({
    mutationFn: (issueIds: string[]) => api.batchDeleteIssues(issueIds),
    onSuccess: (_data, issueIds) => {
      for (const id of issueIds) {
        qc.removeQueries({ queryKey: issueKeys.detail(wsId, id) });
      }
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: issueKeys.all(wsId) });
    },
  });
}
