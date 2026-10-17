/**
 * View store for the workspace-wide Issues page (`more/issues.tsx`): the
 * `all / members / agents` scope tab (see web
 * `packages/views/issues/components/issues-page.tsx:32-94`).
 *
 * The `scope` filter is **client-side** on `assignee_type` — see
 * `more/issues.tsx`'s `scopedIssues` derivation. Server param stays unset
 * so the cache key (`issueKeys.list(wsId)`) and WS realtime invalidation
 * (`useIssuesRealtime`) don't have to know about scope.
 *
 * `IssuesScope` is defined locally rather than imported from
 * `@multica/core/issues/stores/issues-scope-store` — mobile only
 * `import type` from `@multica/core/types/*` per Sharing Principles, and
 * the union is small enough that a duplicated literal is preferable to a
 * cross-package type import hop.
 *
 * The list filters (status, priority, project, label, due date) moved to
 * `issue-list-filter-store.ts`, kept per workspace and across
 * restarts. A workspace switch keeps the user on the same scope tab (web's
 * URL-driven scope reset is incidental to its routing model, not an
 * invariant mobile should mirror).
 */
import { create } from "zustand";

export type IssuesScope = "all" | "members" | "agents";

interface IssuesViewState {
  scope: IssuesScope;
  setScope: (scope: IssuesScope) => void;
}

export const useIssuesViewStore = create<IssuesViewState>((set) => ({
  scope: "all",
  setScope: (scope) => set({ scope }),
}));
