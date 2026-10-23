/**
 * Issue-wakeup mutations. Mirrors the web hooks in
 * packages/views/issues/components/wakeup-*.tsx but binds to mobile's own
 * ApiClient and workspace store.
 *
 * Create, delete, trigger and instruction edits wait for the
 * server (no optimistic removal); only the on/off switch flips optimistically
 * and rolls back on error. Every mutation invalidates the whole
 * `wakeupKeys.all(wsId)` prefix afterwards, because the issue section, the
 * header chip, the overview counts and the paused banner all move together.
 */
import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { IssueWakeupInput, SystemWakeup } from "@multica/core/types";
import { api } from "@/data/api";
import { issueKeys } from "@/data/queries/issue-keys";
import { issueWakeupsOptions, wakeupKeys } from "@/data/queries/wakeups";
import type { MobileIssueWakeup } from "@/data/wakeup-schemas";
import { useWorkspaceStore } from "@/data/workspace-store";
import { disableSequentially } from "@/lib/wakeup-bulk";
import { wakeupErrorKind } from "@/lib/wakeup-actions";

function invalidateWakeups(qc: QueryClient, wsId: string | null) {
  return qc.invalidateQueries({ queryKey: wakeupKeys.all(wsId) });
}

/** Pure cache patch for the optimistic switch; exported for tests. */
export function setWakeupEnabled(
  list: MobileIssueWakeup[] | undefined,
  wakeupId: string,
  enabled: boolean,
): MobileIssueWakeup[] | undefined {
  return list?.map((w) => (w.id === wakeupId ? { ...w, enabled } : w));
}

export function useCreateIssueWakeup(issueId: string) {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  return useMutation({
    mutationFn: (input: IssueWakeupInput) => api.createIssueWakeup(issueId, input),
    onSettled: () => invalidateWakeups(qc, wsId),
  });
}

type ToggleVars = { wakeupId: string } & (
  | { enabled: false }
  | { enabled: true; revision: number; at?: string; rearm?: boolean }
);

export function useToggleIssueWakeup(issueId: string) {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const listKey = issueWakeupsOptions(wsId, issueId).queryKey;
  return useMutation({
    mutationFn: (vars: ToggleVars) =>
      vars.enabled
        ? api.enableIssueWakeup(issueId, vars.wakeupId, {
            revision: vars.revision,
            at: vars.at,
            rearm: vars.rearm,
          })
        : api.disableIssueWakeup(issueId, vars.wakeupId),
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: listKey });
      const previous = qc.getQueryData<MobileIssueWakeup[]>(listKey);
      qc.setQueryData<MobileIssueWakeup[]>(listKey, (old) =>
        setWakeupEnabled(old, vars.wakeupId, vars.enabled),
      );
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(listKey, ctx.previous);
    },
    onSettled: () => invalidateWakeups(qc, wsId),
  });
}

export function useEditIssueWakeupInstruction(issueId: string) {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  return useMutation({
    mutationFn: (vars: {
      wakeupId: string;
      instruction: string;
      expected_instruction: string;
      revision: number;
    }) => {
      const { wakeupId, ...input } = vars;
      return api.editIssueWakeupInstruction(issueId, wakeupId, input);
    },
    onSettled: () => invalidateWakeups(qc, wsId),
  });
}

export function useTriggerIssueWakeup(issueId: string) {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  return useMutation({
    mutationFn: (wakeupId: string) => api.triggerIssueWakeup(issueId, wakeupId),
    onSettled: () => {
      // A trigger starts a run right away: the issue's activity row moves too.
      void qc.invalidateQueries({ queryKey: issueKeys.activeTasks(wsId, issueId) });
      return invalidateWakeups(qc, wsId);
    },
  });
}

export function useDeleteIssueWakeup(issueId: string) {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  return useMutation({
    mutationFn: (wakeupId: string) => api.deleteIssueWakeup(issueId, wakeupId),
    onSettled: () => invalidateWakeups(qc, wsId),
  });
}

export function useUpdateIssueSystemWakeup(issueId: string) {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  return useMutation({
    mutationFn: (vars: {
      rule: SystemWakeup["rule"];
      enabled?: boolean;
      instruction?: string;
    }) => {
      const { rule, ...input } = vars;
      return api.updateIssueSystemWakeup(issueId, rule, input);
    },
    onSuccess: (rules) => {
      // The PUT answers with the issue's full rule list; an empty fallback
      // (unusable body) must not wipe the cache, the refetch fills it.
      if (rules.length > 0) qc.setQueryData(wakeupKeys.system(wsId, issueId), rules);
    },
    onSettled: () => invalidateWakeups(qc, wsId),
  });
}

/**
 * Bulk "Turn off" of the workspace overview: one request
 * after another (lib/wakeup-bulk.ts), the result lists the failed rows.
 * Never rejects; the refetch afterwards moves the switched-off rows out of
 * the "active" scope.
 */
export function useDisableWorkspaceWakeups() {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  return useMutation({
    mutationFn: (rows: { id: string; issue_id: string }[]) =>
      disableSequentially(
        rows,
        (issueId, wakeupId) => api.disableIssueWakeup(issueId, wakeupId),
        (err) => wakeupErrorKind(err) === "forbidden",
      ),
    onSettled: () => invalidateWakeups(qc, wsId),
  });
}
