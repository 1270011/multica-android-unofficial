/**
 * Removable chips for the active issue-list filters, shared by
 * All, My and Project. Tapping a chip removes that one value. Status and
 * priority chips keep their previous look; project, label and due chips
 * resolve names from the workspace lists.
 */
import { Pressable, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { Text } from "@/components/ui/text";
import { Ionicons } from "@/components/ui/ionicons";
import { labelListOptions } from "@/data/queries/labels";
import { projectListOptions } from "@/data/queries/projects";
import { useWorkspaceStore } from "@/data/workspace-store";
import {
  type IssueFilterList,
  useIssueListFilterStore,
} from "@/data/stores/issue-list-filter-store";
import {
  filtersMayMissIssues,
  type IssueListFilters,
} from "@/lib/issue-list-filters";
import { PRIORITY_LABEL } from "@/lib/issue-status";
import { useIssueStatuses } from "@/lib/use-issue-statuses";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { useT } from "@/lib/i18n";

export function ActiveFilterChips({
  list,
  filters,
  loadedCount,
  total,
}: {
  list: IssueFilterList;
  filters: IssueListFilters;
  /** Issues the screen loaded before filtering (cap hint, review #22). */
  loadedCount: number;
  /** Server total of that list (data/queries/list-total.ts). */
  total?: number;
}) {
  const { t } = useT("issues");
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const catalog = useIssueStatuses();
  const needsProjects = filters.projects.length > 0;
  const needsLabels = filters.labels.length > 0;
  const { data: projects = [] } = useQuery({
    ...projectListOptions(wsId),
    enabled: !!wsId && needsProjects,
  });
  const { data: labels = [] } = useQuery({
    ...labelListOptions(wsId),
    enabled: !!wsId && needsLabels,
  });
  if (!wsId) return null;
  const store = useIssueListFilterStore.getState();

  const capped = filtersMayMissIssues(loadedCount, filters, total);
  return (
    <View className="pb-2">
      {capped ? (
        <Text
          accessibilityLiveRegion="polite"
          className="px-4 pb-1.5 text-xs text-muted-foreground"
        >
          {t("filters.limit_hint", { count: loadedCount })}
        </Text>
      ) : null}
      <View className="flex-row flex-wrap gap-1.5 px-4">
        {filters.statuses.map((s) => (
          <Chip
            key={`s-${s}`}
            label={catalog.labelOf(s)}
            onClear={() => store.toggle(list, wsId, "statuses", s)}
          />
        ))}
        {filters.priorities.map((p) => (
          <Chip
            key={`p-${p}`}
            label={t(PRIORITY_LABEL[p])}
            onClear={() => store.toggle(list, wsId, "priorities", p)}
          />
        ))}
        {filters.includeNoProject ? (
          <Chip
            label={t("filters.no_project")}
            onClear={() => store.toggleNoProject(list, wsId)}
          />
        ) : null}
        {filters.projects.map((id) => (
          <Chip
            key={`pr-${id}`}
            label={projects.find((p) => p.id === id)?.title ?? t("filters.project")}
            onClear={() => store.toggle(list, wsId, "projects", id)}
          />
        ))}
        {filters.labels.map((id) => (
          <Chip
            key={`l-${id}`}
            label={labels.find((l) => l.id === id)?.name ?? t("filters.label")}
            onClear={() => store.toggle(list, wsId, "labels", id)}
          />
        ))}
        {filters.due.map((d) => (
          <Chip
            key={`d-${d}`}
            label={t(`filters.due_${d}`)}
            onClear={() => store.toggle(list, wsId, "due", d)}
          />
        ))}
      </View>
    </View>
  );
}

function Chip({ label, onClear }: { label: string; onClear: () => void }) {
  const { t } = useT("issues");
  const { colorScheme } = useColorScheme();
  return (
    <Pressable
      onPress={onClear}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={t("filters.remove_chip", { label })}
      className="flex-row items-center gap-1 pl-2.5 pr-2 py-1 rounded-full border border-border bg-secondary/40 active:bg-secondary"
    >
      <Text className="text-xs text-foreground">{label}</Text>
      <Ionicons
        name="close"
        size={12}
        color={THEME[colorScheme].mutedForeground}
      />
    </Pressable>
  );
}
