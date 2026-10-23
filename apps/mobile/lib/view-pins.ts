/**
 * Pinned saved views: ⋯ → "Anpinnen"/"Lösen" in the sheet "Ansichten", and the
 * pinned views under "Mehr → Angepinnt", where a tap opens the list with
 * that view. Pure helpers, so the navigation is testable without a screen.
 *
 * Where a pinned view opens mirrors web's sidebar (app-sidebar.tsx PinRow):
 * `my` and `workspace` views open My Issues with the view applied (the view
 * sets tab, filters, sort and mode, lib/issue-view-mapping.ts); a project
 * view opens its project, which has no view bar in the app yet.
 */
import type { IssueView } from "@multica/core/api/schemas";
import type { PinnedItem } from "@multica/core/types";

export function isViewPinned(
  pins: readonly PinnedItem[] | undefined,
  viewId: string,
): boolean {
  return !!pins?.some((p) => p.item_type === "view" && p.item_id === viewId);
}

/** 409 on `POST /api/pins`: already pinned (other device, double tap). */
export function isAlreadyPinned(error: unknown): boolean {
  return (error as { status?: unknown } | null)?.status === 409;
}

export type PinnedViewTarget =
  | { kind: "my-issues" }
  | { kind: "project"; projectId: string };

export function pinnedViewTarget(
  view: Pick<IssueView, "scope_type" | "scope_id">,
): PinnedViewTarget {
  if (view.scope_type === "project" && view.scope_id) {
    return { kind: "project", projectId: view.scope_id };
  }
  return { kind: "my-issues" };
}

export function pinnedViewHref(target: PinnedViewTarget, wsSlug: string) {
  return target.kind === "project"
    ? {
        pathname: "/[workspace]/project/[id]" as const,
        params: { workspace: wsSlug, id: target.projectId },
      }
    : { pathname: "/[workspace]/my-issues" as const, params: { workspace: wsSlug } };
}

/**
 * Tap on a pinned view. For My Issues the view is applied first (fresh
 * read; a 404 there toasts "gone" and leaves the list alone), and only an
 * applied view navigates, so the list never opens with the wrong filters.
 */
export async function openPinnedView(
  view: Pick<IssueView, "id" | "scope_type" | "scope_id">,
  wsSlug: string,
  deps: {
    applyView: (id: string) => Promise<"apply" | "gone" | "error">;
    navigate: (href: ReturnType<typeof pinnedViewHref>) => void;
  },
): Promise<boolean> {
  const target = pinnedViewTarget(view);
  if (target.kind === "my-issues" && (await deps.applyView(view.id)) !== "apply") {
    return false;
  }
  deps.navigate(pinnedViewHref(target, wsSlug));
  return true;
}

export type ViewRowAction = "pin" | "unpin" | "edit";

/**
 * Actions of the one "⋯" per row in the sheet "Ansichten": pinning is open
 * to everyone (D8d), "Bearbeiten …" (D8c) only for who may manage the view.
 */
export function viewRowActions(pinned: boolean, canManage: boolean): ViewRowAction[] {
  return [pinned ? "unpin" : "pin", ...(canManage ? (["edit"] as const) : [])];
}
