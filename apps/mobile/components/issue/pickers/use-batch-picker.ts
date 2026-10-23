/**
 * Shared wiring of the batch pickers (`batch-picker/*` routes):
 * the selected ids from `useIssueSelectionStore`, the value they share (for
 * the check mark; null when they differ), and `apply`, which starts
 * `useBatchUpdateIssues` and closes the sheet. Closing the sheet in any way
 * clears the store's `pickerOpen`, so the list may end the selection on its
 * next blur again.
 */
import { useEffect, useMemo } from "react";
import { router } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import type { UpdateIssueRequest } from "@multica/core/types";
import { useBatchUpdateIssues } from "@/data/mutations/issue-move-batch";
import { useIssueSelectionStore } from "@/data/stores/issue-selection-store";
import { useWorkspaceStore } from "@/data/workspace-store";
import { selectedIssuesFromCache } from "@/lib/issue-batch";

export function useBatchPicker() {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const ids = useIssueSelectionStore((s) => s.ids);
  const batch = useBatchUpdateIssues();
  const issues = useMemo(() => selectedIssuesFromCache(qc, wsId, ids), [qc, wsId, ids]);

  useEffect(() => () => useIssueSelectionStore.getState().setPickerOpen(false), []);

  const apply = (updates: UpdateIssueRequest) => {
    if (ids.length > 0) batch.mutate({ issueIds: [...ids], updates });
    router.back();
  };

  return { count: ids.length, issues, apply };
}
