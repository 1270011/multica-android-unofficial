/**
 * Inbox title display helpers.
 *
 * Mirrors packages/views/inbox/components/inbox-display.ts. Keeping behavior
 * identical is required by apps/mobile/CLAUDE.md "Behavioral parity":
 * the title a user sees in the mobile inbox MUST match what they see on
 * web for the same item. When the web version changes, sync this file.
 */
import type { InboxItem } from "@multica/core/types";
import { i18n } from "@/lib/i18n/singleton";
import { opensInChat } from "@/lib/issue-chat";

function formatResetAt(value: string | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(i18n.resolvedLanguage ?? i18n.language, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function getAutopilotQuotaBody(item: InboxItem): string | null {
  if (item.type !== "autopilot_quota_exceeded") return item.body;
  const details = item.details ?? {};
  const resetAt = formatResetAt(details.reset_at);
  if (!details.limit || !resetAt) return item.body;
  const t = i18n.t.bind(i18n);
  if (details.autopilot_title) {
    return t("inbox:body.autopilot_title_limit", {
      title: details.autopilot_title,
      limit: details.limit,
      resetAt,
    });
  }
  return t("inbox:body.autopilot_limit", {
    limit: details.limit,
    resetAt,
  });
}

function singleLine(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function stripQuickCreatePrefix(
  title: string,
  identifier?: string,
): string {
  const normalized = singleLine(title);
  if (!normalized) return "";
  if (identifier) {
    const exactPrefix = new RegExp(
      `^Created\\s+${escapeRegExp(identifier)}:\\s*`,
      "i",
    );
    const withoutExactPrefix = normalized.replace(exactPrefix, "");
    if (withoutExactPrefix !== normalized) return withoutExactPrefix.trim();
  }
  return normalized.replace(/^Created\s+[A-Z][A-Z0-9]*-\d+:\s*/i, "").trim();
}

export function getInboxDisplayTitle(item: InboxItem): string {
  const details = item.details ?? {};
  // Resolve system-notice titles through the selected UI locale. Mirror
  // rather than exposing backend fallback copy that can include raw counts.
  switch (item.type) {
    case "autopilot_quota_exceeded":
      return i18n.t("inbox:type.autopilot_quota_exceeded");
  }
  if (item.type === "quick_create_done") {
    const cleanedTitle = stripQuickCreatePrefix(item.title, details.identifier);
    if (cleanedTitle) return cleanedTitle;
    const prompt = singleLine(details.original_prompt);
    if (prompt) return prompt;
  }
  // Both non-success quick-create outcomes surface the user's original input
  // as the row title. Mirrors isQuickCreateOutcome in
  // packages/views/inbox/components/inbox-display.ts.
  if (item.type === "quick_create_failed" || item.type === "quick_create_unconfirmed") {
    const prompt = singleLine(details.original_prompt);
    if (prompt) return prompt;
  }
  return item.title;
}

export function getInboxNavigationTarget(
  item: InboxItem,
  workspace: string | null,
  historyToken: string,
) {
  if (!workspace) return null;
  if (item.issue_id) {
    return {
      pathname: "/[workspace]/issue/[id]" as const,
      params: {
        workspace,
        id: item.issue_id,
        highlight: item.details?.comment_id,
        h: historyToken,
      },
    };
  }
  if (
    item.type === "autopilot_quota_exceeded" ||
    item.type === "autopilot_paused"
  ) {
    return {
      pathname: "/[workspace]/inbox/[id]" as const,
      params: { workspace, id: item.id },
    };
  }
  return null;
}

/**
 * Where tapping an inbox row goes: conversation
 * and action types open the issue chat at the reported comment, everything
 * else the detail as before. `mode` forces one of them (long-press menu).
 */
export function getInboxOpenTarget(
  item: InboxItem,
  workspace: string | null,
  historyToken: string,
  mode: "auto" | "chat" | "detail" = "auto",
) {
  const chat =
    !!workspace &&
    !!item.issue_id &&
    (mode === "chat" || (mode === "auto" && opensInChat(item)));
  if (!chat) return getInboxNavigationTarget(item, workspace, historyToken);
  return {
    pathname: "/[workspace]/issue/[id]/chat" as const,
    params: {
      workspace: workspace!,
      id: item.issue_id!,
      comment: item.details?.comment_id,
      h: historyToken,
    },
  };
}

/**
 * Deduplicate inbox items by issue_id (Linear-style: one entry per issue).
 *
 * Mirrors packages/core/inbox/queries.ts deduplicateInboxItems. **MUST stay
 * aligned with that function** — see the inbox dedup incident in this file's
 * companion `apps/mobile/CLAUDE.md` "Behavioral parity" section. Skipping
 * this step makes the same workspace/user show different unread counts on
 * mobile vs web.
 *
 * Steps:
 *   1. Drop archived rows (these never appear in web's inbox view).
 *   2. Group by `issue_id` (fall back to `id` for items with no issue
 *      attached — e.g. quick_create_failed).
 *   3. In each group, keep the newest by `created_at`.
 *   4. Preserve the newest grouped `comment_id` anchor when the newest row
 *      is a later status/metadata event for the same issue.
 *   5. Sort the result newest-first.
 */
export function deduplicateInboxItems(items: InboxItem[]): InboxItem[] {
  const active = items.filter((i) => !i.archived);
  const groups = new Map<string, InboxItem[]>();
  for (const item of active) {
    const key = item.issue_id ?? item.id;
    const group = groups.get(key) ?? [];
    group.push(item);
    groups.set(key, group);
  }
  const merged: InboxItem[] = [];
  for (const group of groups.values()) {
    group.sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    );
    const newest = group[0];
    if (!newest) continue;

    const commentId =
      newest.details?.comment_id ??
      group.find((item) => item.details?.comment_id)?.details?.comment_id;

    if (commentId && newest.details?.comment_id !== commentId) {
      merged.push({
        ...newest,
        details: { ...(newest.details ?? {}), comment_id: commentId },
      });
      continue;
    }

    merged.push(newest);
  }
  return merged.sort(
    (a, b) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );
}

export type InboxView = "all" | "unread" | "archived";

/**
 * Apply the inbox view (segment above the list) to the deduplicated list.
 * "archived" is served by its own query (`inboxArchivedOptions`), so for
 * that view the caller passes the archived rows and this is a pass-through
 * minus the dedup step's archived filter. Mirrors web's "unread only"
 * filter in packages/views/inbox/components/inbox-filter-menu.tsx.
 */
export function filterInboxView(items: InboxItem[], view: InboxView): InboxItem[] {
  if (view === "unread") return items.filter((i) => !i.read);
  return items;
}
