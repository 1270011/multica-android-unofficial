/**
 * Mobile-only zustand store for the My Issues scope tab
 * (`assigned / created / agents`), mirroring web's
 * `packages/core/issues/stores/my-issues-view-store.ts` scope field.
 *
 * The list filters (status, priority, project, label, due date) moved to
 * `issue-list-filter-store.ts`, kept per workspace and across
 * restarts.
 */
import { create } from "zustand";
import type { MyIssuesScope } from "@/data/queries/issue-keys";

interface MyIssuesViewState {
  scope: MyIssuesScope;
  setScope: (scope: MyIssuesScope) => void;
}

export const useMyIssuesViewStore = create<MyIssuesViewState>((set) => ({
  scope: "assigned",
  setScope: (scope) => set({ scope }),
}));
