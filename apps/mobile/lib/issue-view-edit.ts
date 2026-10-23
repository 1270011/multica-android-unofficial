/**
 * Edit, share and delete a saved view.
 *
 * - `canManageView`: who may edit, share, delete and save into a view. Same
 *   rule as the web's `canManageIssueView`: the owner, or a workspace
 *   owner/admin for views shared to the workspace. The server re-checks.
 * - `isViewModified`: the filters on screen differ from the applied view
 *   ("· geändert"). Both sides go through `viewDefinitionFromApp`, so the
 *   app-only due filter and the order of chosen values do not count.
 * - `saveIntoViewRequest` / `editViewRequest`: `PATCH` bodies, always with
 *   `expected_revision`. Saving keeps the view's unknown keys (D8a).
 * - `viewUpdateErrorKind` + `viewConflictDialog`: a 409 means someone else
 *   changed the view; the dialog offers "Neu laden" and, when saving the
 *   filters, "Als neue Ansicht speichern".
 * - `viewSaveButton`: offline "Speichern" stays visible but disabled with
 *   "Offline – zum Speichern verbinden"; the change stays "· geändert"
 *   (nothing is queued).
 */
import type { IssueView } from "@multica/core/api/schemas";
import { type AppViewState, viewDefinitionFromApp } from "./issue-view-mapping";
import { viewCreateErrorKind } from "./issue-view-create";

type ManageableView = Pick<IssueView, "owner_id" | "visibility">;

export function canManageView(
  view: ManageableView,
  userId: string | null | undefined,
  role: string | null | undefined,
): boolean {
  if (!userId) return false;
  if (view.owner_id === userId) return true;
  return view.visibility === "workspace" && (role === "owner" || role === "admin");
}

/** Sharing only exists for workspace views; `my` views stay private. */
export function canChangeVisibility(view: Pick<IssueView, "scope_type">): boolean {
  return view.scope_type === "workspace";
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value
      .map(canonical)
      .map((v) => JSON.stringify(v))
      .sort()
      .map((s) => JSON.parse(s) as unknown);
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .map((k) => [k, canonical(record[k])]),
    );
  }
  return value;
}

/** Filters, sort, tab or list/board on screen differ from the applied view. */
export function isViewModified(applied: AppViewState, current: AppViewState): boolean {
  const a = viewDefinitionFromApp(applied);
  const b = viewDefinitionFromApp(current);
  return JSON.stringify(canonical(a)) !== JSON.stringify(canonical(b));
}

/**
 * The screen state can be saved into `view`: same scope type (PATCH cannot
 * move a view between `my` and `workspace`, e.g. after switching on "My
 * agents and squads" in All). Otherwise only "Verwerfen" is offered.
 */
export function canSaveIntoView(
  view: Pick<IssueView, "scope_type">,
  current: AppViewState,
): boolean {
  return viewDefinitionFromApp(current).scope_type === view.scope_type;
}

export interface ViewPatch {
  name?: string;
  visibility?: "private" | "workspace";
  scope_variant?: string | null;
  query?: Record<string, unknown>;
  display?: Record<string, unknown>;
  expected_revision: number;
}

/** "Speichern" in the bar: current filters into the applied view. */
export function saveIntoViewRequest(
  view: Pick<IssueView, "query" | "display" | "revision">,
  current: AppViewState,
): ViewPatch {
  const def = viewDefinitionFromApp(current, view);
  return {
    scope_variant: def.scope_variant,
    query: def.query,
    display: def.display,
    expected_revision: view.revision,
  };
}

/** Edit sheet: only changed fields; visibility only for workspace views. */
export function editViewRequest(
  view: Pick<IssueView, "name" | "visibility" | "scope_type" | "revision">,
  name: string,
  shared: boolean,
): ViewPatch {
  const patch: ViewPatch = { expected_revision: view.revision };
  const trimmed = name.trim();
  if (trimmed !== view.name) patch.name = trimmed;
  const visibility = shared ? "workspace" : "private";
  if (canChangeVisibility(view) && visibility !== view.visibility) {
    patch.visibility = visibility;
  }
  return patch;
}

export type ViewSaveButton = "hidden" | "save" | "saving" | "offline";

/**
 * "Speichern" in the bar. Offline wins over a running save: `runWhileOnline`
 * gives up on the request the moment the link drops.
 */
export function viewSaveButton(state: {
  canSave: boolean;
  saving: boolean;
  online: boolean;
}): ViewSaveButton {
  if (!state.canSave) return "hidden";
  if (!state.online) return "offline";
  return state.saving ? "saving" : "save";
}

export function hasViewChanges(patch: ViewPatch): boolean {
  return Object.keys(patch).some((k) => k !== "expected_revision");
}

export type ViewUpdateErrorKind =
  | "name"
  | "conflict"
  | "forbidden"
  | "gone"
  | "offline"
  | "failed";

/** PATCH/DELETE answer → what the app shows. 409 = changed elsewhere. */
export function viewUpdateErrorKind(err: unknown): ViewUpdateErrorKind {
  const status = (err as { status?: unknown } | null)?.status;
  if (status === 409) return "conflict";
  if (status === 404) return "gone";
  const kind = viewCreateErrorKind(err);
  if (kind === "name" || kind === "forbidden" || kind === "offline") return kind;
  return "failed";
}

export type ViewConflictAction = "reload" | "save_as_new" | "cancel";

export interface ViewConflictDialog {
  readonly titleKey: string;
  readonly messageKey: string;
  readonly buttons: readonly {
    readonly action: ViewConflictAction;
    readonly labelKey: string;
    readonly style: "default" | "cancel";
  }[];
}

/**
 * 409 dialog (spec §4 "Fehler"): "Neu laden" fetches the server version and
 * drops the own change; saving the filters also offers "Als neue Ansicht
 * speichern". Overwriting someone else's change is not offered.
 */
export function viewConflictDialog(context: "save" | "edit"): ViewConflictDialog {
  return {
    titleKey: "issues:views.edit.conflict_title",
    messageKey: "issues:views.edit.conflict_message",
    buttons: [
      { action: "cancel", labelKey: "common:actions.cancel", style: "cancel" },
      ...(context === "save"
        ? [
            {
              action: "save_as_new" as const,
              labelKey: "issues:views.edit.save_as_new",
              style: "default" as const,
            },
          ]
        : []),
      { action: "reload", labelKey: "issues:views.edit.reload", style: "default" },
    ],
  };
}
