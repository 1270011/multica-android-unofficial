/**
 * Saved issue views + view preferences (UX §6 J). No optimism: views are
 * edited from a sheet where a round-trip is fine, and the server assigns
 * ids/revisions. Every write refreshes the workspace's view caches.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { CreateIssueViewRequest } from "@multica/core/api/schemas";
import { api } from "@/data/api";
import { issueViewKeys } from "@/data/queries/issue-views";
import { useWorkspaceStore } from "@/data/workspace-store";

type UpdateIssueViewVars = { id: string } & Parameters<typeof api.updateIssueView>[1];
type PutPreferenceVars = Parameters<typeof api.putIssueViewPreference>[0];

function useInvalidateViews() {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  return () => qc.invalidateQueries({ queryKey: issueViewKeys.all(wsId) });
}

export function useCreateIssueView() {
  const invalidate = useInvalidateViews();
  return useMutation({
    mutationFn: (data: CreateIssueViewRequest) => api.createIssueView(data),
    onSettled: invalidate,
  });
}

export function useUpdateIssueView() {
  const invalidate = useInvalidateViews();
  return useMutation({
    mutationFn: ({ id, ...data }: UpdateIssueViewVars) => api.updateIssueView(id, data),
    onSettled: invalidate,
  });
}

export function useDeleteIssueView() {
  const invalidate = useInvalidateViews();
  return useMutation({
    mutationFn: (id: string) => api.deleteIssueView(id),
    onSettled: invalidate,
  });
}

export function usePutIssueViewPreference() {
  const invalidate = useInvalidateViews();
  return useMutation({
    mutationFn: (data: PutPreferenceVars) => api.putIssueViewPreference(data),
    onSettled: invalidate,
  });
}
