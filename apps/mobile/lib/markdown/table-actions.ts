/**
 * Opening a table in the full view (rows 14–16): the
 * "Als Tabelle öffnen" button under cards and the TalkBack actions on the
 * chat bubble and the comment card ("Tabelle in Vollansicht öffnen", with
 * several tables "Tabelle 1 öffnen" …). The full view is its own stack
 * screen, so the chat or activity under it stays mounted and keeps its
 * scroll position; Back and ✕ pop it.
 */
import { useCallback, useMemo } from "react";
import { router } from "expo-router";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useT } from "@/lib/i18n";
import { getMarkdownSegments } from "./segment-cache";
import { tableIndexFromAction, tableOpenActions, type TableModel } from "./table-model";
import { useMarkdownEntryId } from "./content-width-context";
import { putTableForView, setTableViewOrigin } from "./table-view-store";

export function useOpenTableView(): (table: TableModel) => void {
  const wsSlug = useWorkspaceStore((s) => s.currentWorkspaceSlug);
  const entryId = useMarkdownEntryId();
  return useCallback(
    (table: TableModel) => {
      if (!wsSlug) return;
      setTableViewOrigin(entryId, table);
      router.push(`/${wsSlug}/table-view?key=${putTableForView(table)}`);
    },
    [wsSlug, entryId],
  );
}

/**
 * Accessibility actions for a message body with tables. Spread `actions`
 * into the surface's `accessibilityActions`; `onAction(name)` opens the
 * table and returns true when the action was one of these.
 */
export function useTableA11yActions(content: string | null | undefined): {
  actions: { name: string; label: string }[];
  onAction: (name: string) => boolean;
} {
  const { t } = useT("common");
  const open = useOpenTableView();
  const tables = useMemo(
    () =>
      content
        ? getMarkdownSegments(content).flatMap((s) => (s.type === "table" ? [s.table] : []))
        : [],
    [content],
  );
  const actions = useMemo(
    () =>
      tableOpenActions(tables.length, {
        one: t("table.open_full_a11y"),
        nth: (n) => t("table.open_nth_a11y", { n }),
      }),
    [tables.length, t],
  );
  const onAction = useCallback(
    (name: string) => {
      const i = tableIndexFromAction(name);
      if (i === null || !tables[i]) return false;
      open(tables[i]);
      return true;
    },
    [tables, open],
  );
  return { actions, onAction };
}
