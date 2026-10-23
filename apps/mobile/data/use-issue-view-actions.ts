/**
 * Apply a saved view in My Issues, or go back to "Standard".
 *
 * Applying reads the view fresh (`GET /api/issue-views/{id}`, no cache): a
 * 404 means deleted or no longer shared → toast, back to "Standard", reload
 * the view list. Otherwise filters, sort, tab and list/board are set from
 * the view (lib/issue-view-mapping.ts).
 *
 * Creating (D8b) posts the current state as a new view; the new view is
 * then the active one. The screen keeps its own state (no re-apply), so an
 * app-only filter like "due" stays on screen though it is not saved.
 *
 * "Speichern" patches the applied view with the filters on screen,
 * "Verwerfen" puts the view's filters back, the edit sheet renames, shares
 * or deletes a view. Writes send `expected_revision`; errors are thrown
 * (see `viewUpdateErrorKind`). Deleting the applied view goes back to
 * "Standard".
 */
import { useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  issueViewDetailOptions,
  issueViewKeys,
  issueViewListOptions,
} from "@/data/queries/issue-views";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useIssueListFilterStore } from "@/data/stores/issue-list-filter-store";
import {
  DEFAULT_MY_ISSUES_SCOPE,
  useMyIssuesViewStore,
} from "@/data/stores/my-issues-view-store";
import { useIssueViewModeStore } from "@/data/stores/issue-view-mode-store";
import { useActiveIssueViewStore } from "@/data/stores/active-issue-view-store";
import { EMPTY_ISSUE_LIST_FILTERS } from "@/lib/issue-list-filters";
import { MANUAL_SORT } from "@/lib/issue-list-sort";
import type { IssueView } from "@multica/core/api/schemas";
import { api } from "@/data/api";
import {
  activeViewGone,
  type AppViewState,
  viewFetchOutcome,
} from "@/lib/issue-view-mapping";
import { createViewRequest } from "@/lib/issue-view-create";
import {
  canManageView,
  saveIntoViewRequest,
  type ViewPatch,
  viewUpdateErrorKind,
} from "@/lib/issue-view-edit";
import { memberListOptions } from "@/data/queries/members";
import { useAuthStore } from "@/data/auth-store";
import { showToast } from "@/lib/toast";

export function currentState(wsId: string): AppViewState {
  const filters = useIssueListFilterStore.getState();
  return {
    tab: useMyIssuesViewStore.getState().scopes[wsId] ?? DEFAULT_MY_ISSUES_SCOPE,
    filters: filters.filters[`my:${wsId}`] ?? EMPTY_ISSUE_LIST_FILTERS,
    sort: filters.sorts[`my:${wsId}`] ?? MANUAL_SORT,
    viewMode: useIssueViewModeStore.getState().modes.my ?? "list",
  };
}

function putState(wsId: string, state: AppViewState) {
  const filters = useIssueListFilterStore.getState();
  filters.replace("my", wsId, state.filters);
  filters.setSort("my", wsId, state.sort);
  useMyIssuesViewStore.getState().setScope(wsId, state.tab);
  useIssueViewModeStore.getState().setMode("my", state.viewMode);
}

export function useIssueViewActions() {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);

  const exitView = () => {
    if (!wsId) return;
    const previous = useActiveIssueViewStore.getState().exit(wsId);
    if (previous) putState(wsId, previous);
  };

  const applyView = async (id: string): Promise<"apply" | "gone" | "error"> => {
    if (!wsId) return "error";
    let result: Parameters<typeof viewFetchOutcome>[0];
    try {
      result = {
        view: await qc.fetchQuery({ ...issueViewDetailOptions(wsId, id), staleTime: 0 }),
      };
    } catch (error) {
      result = { error };
    }
    const outcome = viewFetchOutcome(result);
    if (outcome === "apply" && "view" in result && result.view) {
      const applied = useActiveIssueViewStore
        .getState()
        .apply(wsId, result.view, currentState(wsId));
      putState(wsId, applied);
    } else if (outcome === "gone") {
      showToast({ key: "issues:views.gone" });
      if (useActiveIssueViewStore.getState().active[wsId]?.id === id) exitView();
      void qc.invalidateQueries({ queryKey: issueViewKeys.all(wsId) });
    } else {
      showToast({ key: "issues:views.apply_failed" });
    }
    return outcome;
  };

  /** Throws the ApiError (see `viewCreateErrorKind`); null = no workspace. */
  const createView = async (name: string, shared: boolean): Promise<IssueView | null> => {
    if (!wsId) return null;
    const current = currentState(wsId);
    const view = await api.createIssueView(createViewRequest(current, name, shared));
    void qc.invalidateQueries({ queryKey: issueViewKeys.all(wsId) });
    if (view) useActiveIssueViewStore.getState().apply(wsId, view, current);
    return view;
  };

  /** "Speichern" in the bar. Throws the ApiError (409 = changed elsewhere). */
  const saveActiveView = async (): Promise<IssueView | null> => {
    if (!wsId) return null;
    const active = useActiveIssueViewStore.getState().active[wsId];
    if (!active) return null;
    const current = currentState(wsId);
    const view = await api.updateIssueView(active.id, saveIntoViewRequest(active.view, current));
    void qc.invalidateQueries({ queryKey: issueViewKeys.all(wsId) });
    if (view) useActiveIssueViewStore.getState().update(wsId, view, current);
    return view;
  };

  /** "Verwerfen": back to the filters of the applied view. */
  const discardChanges = () => {
    if (!wsId) return;
    const active = useActiveIssueViewStore.getState().active[wsId];
    if (active) putState(wsId, active.applied);
  };

  /** Rename / share from the edit sheet. Throws the ApiError. */
  const editView = async (id: string, patch: ViewPatch): Promise<IssueView | null> => {
    if (!wsId) return null;
    const view = await api.updateIssueView(id, patch);
    void qc.invalidateQueries({ queryKey: issueViewKeys.all(wsId) });
    if (view) useActiveIssueViewStore.getState().update(wsId, view);
    return view;
  };

  /**
   * Delete; the applied view goes back to "Standard". A 404 (already gone)
   * counts as deleted; other errors are thrown.
   */
  const deleteView = async (id: string) => {
    if (!wsId) return;
    try {
      await api.deleteIssueView(id);
    } catch (err) {
      if (viewUpdateErrorKind(err) !== "gone") throw err;
    } finally {
      void qc.invalidateQueries({ queryKey: issueViewKeys.all(wsId) });
    }
    if (useActiveIssueViewStore.getState().active[wsId]?.id === id) exitView();
  };

  return {
    applyView,
    exitView,
    createView,
    saveActiveView,
    discardChanges,
    editView,
    deleteView,
  };
}

/**
 * A restored view that was deleted or unshared elsewhere goes back to
 * "Standard" silently once the view lists have loaded, instead
 * of staying in the bar until "Anwenden"/"Speichern" hits the 404. Only
 * lists read after the view became active count, so a just-created view is
 * not dropped against an older cached list.
 */
export function useDropGoneActiveView(activeId: string | null) {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const { exitView } = useIssueViewActions();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- new time per view
  const since = useMemo(() => Date.now(), [activeId]);
  const opts = { enabled: !!wsId && !!activeId, refetchOnMount: "always" as const };
  const my = useQuery({ ...issueViewListOptions(wsId, { scope_type: "my" }), ...opts });
  const ws = useQuery({ ...issueViewListOptions(wsId, { scope_type: "workspace" }), ...opts });
  const gone = !!activeId && activeViewGone(activeId, [my, ws], since);
  useEffect(() => {
    if (gone) exitView();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per verdict
  }, [gone]);
}

/** `canManageView` for the signed-in user (role from the member list). */
export function useCanManageView() {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const { data: members } = useQuery(memberListOptions(wsId));
  const role = members?.find((m) => m.user_id === userId)?.role ?? null;
  return (view: Pick<IssueView, "owner_id" | "visibility">) =>
    canManageView(view, userId, role);
}
