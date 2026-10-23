/**
 * Save the current My Issues filters as a new view.
 *
 * - `checkViewName`: trimmed, 1–80 characters (server rule, counted in
 *   code points like Go's `[]rune`), and not the name of a view already
 *   offered in this tab. The server allows duplicates; the app does not,
 *   so the sheet stays readable.
 * - `createViewRequest`: `POST /api/issue-views` body from the app state
 *   via `viewDefinitionFromApp` (D8a). Views in Assigned/Created (and All +
 *   "My agents and squads") are `my` views and always private.
 * - `viewCreateErrorKind`: server answer → text shown in the sheet.
 */
import type { CreateIssueViewRequest } from "@multica/core/api/schemas";
import { type AppViewState, viewDefinitionFromApp } from "./issue-view-mapping";

export const ISSUE_VIEW_NAME_MAX = 80;

export type ViewNameCheck =
  | { ok: true; name: string }
  | { ok: false; reason: "empty" | "too_long" | "duplicate" };

/** Characters as the server counts them (code points, not UTF-16 units). */
export function viewNameLength(name: string): number {
  return [...name.trim()].length;
}

export function checkViewName(
  raw: string,
  existingNames: readonly string[] = [],
): ViewNameCheck {
  const name = raw.trim();
  const length = viewNameLength(name);
  if (length === 0) return { ok: false, reason: "empty" };
  if (length > ISSUE_VIEW_NAME_MAX) return { ok: false, reason: "too_long" };
  const key = name.toLocaleLowerCase();
  if (existingNames.some((n) => n.trim().toLocaleLowerCase() === key)) {
    return { ok: false, reason: "duplicate" };
  }
  return { ok: true, name };
}

/** Sharing only exists outside `my` (spec: "immer privat"). */
export function canShareView(state: AppViewState): boolean {
  return viewDefinitionFromApp(state).scope_type === "workspace";
}

export function createViewRequest(
  state: AppViewState,
  name: string,
  shared: boolean,
): CreateIssueViewRequest {
  const def = viewDefinitionFromApp(state);
  return {
    name: name.trim(),
    scope_type: def.scope_type,
    scope_id: null,
    scope_variant: def.scope_variant,
    visibility: shared && def.scope_type === "workspace" ? "workspace" : "private",
    definition_version: 1,
    query: def.query,
    display: def.display,
  };
}

export type ViewCreateErrorKind =
  | "name"
  | "limit"
  | "duplicate"
  | "forbidden"
  | "offline"
  | "failed";

/**
 * Duck-typed ApiError (data/api.ts: `status`, server text in `message`).
 * 400 is split by the server message (issue_view.go): name length vs. the
 * limit of 100 views per person and workspace. 409 is a name clash (a
 * newer server may reject duplicates). No status = no answer (offline).
 */
export function viewCreateErrorKind(err: unknown): ViewCreateErrorKind {
  const e = err as { status?: unknown; message?: unknown } | null;
  const status = e?.status;
  const message = typeof e?.message === "string" ? e.message.toLowerCase() : "";
  if (typeof status !== "number" || status === 0) {
    return e instanceof TypeError || status === 0 ? "offline" : "failed";
  }
  if (status === 400) {
    if (message.includes("limit")) return "limit";
    if (message.includes("name")) return "name";
    return "failed";
  }
  if (status === 409) return "duplicate";
  if (status === 403) return "forbidden";
  return "failed";
}
