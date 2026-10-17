import { stripChannelMediaMarkers } from "@multica/core/types";
import type { UpdateIssueRequest } from "@multica/core/types";

/**
 * Title/description edits with conflict protection.
 *
 * The edit screen remembers what the issue looked like when editing began
 * (`base`). A save sends only the fields the user changed, each with its
 * baseline: `title_base` lets the server reject a title that someone else
 * changed meanwhile (409 `revision_conflict`), `description_base` lets it
 * merge channel media. The server keeps descriptions last-write-wins, so
 * the screen re-reads the issue before saving and compares on the client
 * (`detectTextConflict`) — same rule the server applies to the title.
 *
 * `base.description` is the raw server text (with channel media markers);
 * the draft is what the form shows, i.e. without markers. Comparisons that
 * mean "did the user change it" therefore strip the base first.
 */
export interface IssueText {
  title: string;
  description: string;
}

type ServerText = { title: string; description: string | null };

/** What the form shows for a raw server description. */
const shown = (raw: string) => stripChannelMediaMarkers(raw).trim();

const titleChanged = (draft: IssueText, base: IssueText) => draft.title.trim() !== base.title;
const descriptionChanged = (draft: IssueText, base: IssueText) =>
  draft.description.trim() !== shown(base.description);

export function buildIssueTextUpdate(
  draft: IssueText,
  base: IssueText,
): UpdateIssueRequest {
  const patch: UpdateIssueRequest = {};
  if (titleChanged(draft, base)) {
    patch.title = draft.title.trim();
    patch.title_base = base.title;
  }
  if (descriptionChanged(draft, base)) {
    patch.description = draft.description.trim();
    patch.description_base = base.description;
  }
  return patch;
}

export interface TextConflict {
  title: boolean;
  description: boolean;
}

/**
 * A field conflicts when the user changed it, the server copy moved away
 * from the baseline, and the two did not happen to land on the same text.
 */
export function detectTextConflict(
  base: IssueText,
  draft: IssueText,
  server: ServerText,
): TextConflict {
  const serverDescription = server.description ?? "";
  return {
    title:
      titleChanged(draft, base) &&
      server.title !== base.title &&
      server.title !== draft.title.trim(),
    description:
      descriptionChanged(draft, base) &&
      serverDescription !== base.description &&
      shown(serverDescription) !== draft.description.trim(),
  };
}

export function hasConflict(c: TextConflict): boolean {
  return c.title || c.description;
}

export type ConflictChoice = "reload" | "keep_mine";

/**
 * Resolve a conflict field by field against the server copy. The new base
 * is always the server copy; what changes is the draft:
 *
 * - a field the user did not touch takes the server text, so a later write
 *   can never send the old text back over someone else's change;
 * - "reload" also takes the server text for the conflicting fields;
 * - "keep_mine" keeps the user's text for the fields they changed, which
 *   then wins against the new base.
 *
 * `draft` comes back in form shape (description without markers).
 */
export function resolveConflict(
  base: IssueText,
  draft: IssueText,
  server: ServerText,
  conflict: TextConflict,
  choice: ConflictChoice,
): { draft: IssueText; base: IssueText } {
  const next: IssueText = { title: server.title, description: server.description ?? "" };
  const keep = (changed: boolean, conflicting: boolean) =>
    changed && (choice === "keep_mine" || !conflicting);
  return {
    base: next,
    draft: {
      title: keep(titleChanged(draft, base), conflict.title) ? draft.title : next.title,
      description: keep(descriptionChanged(draft, base), conflict.description)
        ? draft.description
        : stripChannelMediaMarkers(next.description),
    },
  };
}

/** Server 409 for a stale `title_base` (handler.go writeEditConflict). */
export function isRevisionConflict(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { status?: unknown; body?: unknown };
  if (e.status !== 409) return false;
  const body = e.body as { code?: unknown } | undefined;
  return body?.code === "revision_conflict";
}
