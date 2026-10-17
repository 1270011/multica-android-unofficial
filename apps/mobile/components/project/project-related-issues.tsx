/**
 * Project issues use concrete status sections, like the other issue lists.
 * Filters (status, priority, label, due date; no project filter on a
 * project) use the shared issue-list sheet with `scope=project`, kept per
 * workspace across restarts.
 */
import { useMemo } from "react";
import { View, useWindowDimensions } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import type { IssueStatus } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { StatusIcon } from "@/components/ui/status-icon";
import { IssueRow } from "@/components/issue/issue-row";
import { IssueBoard } from "@/components/issue/board/issue-board";
import { ViewModeToggle } from "@/components/issue/view-mode-toggle";
import { useIssueViewMode } from "@/data/stores/issue-view-mode-store";
import { IssuesLoading } from "@/components/issue/issues-loading";
import { ActiveFilterChips } from "@/components/issue/active-filter-chips";
import { Ionicons } from "@/components/ui/ionicons";
import { useIssueListFilters } from "@/data/stores/issue-list-filter-store";
import {
  filterIssueList,
  issueListFilterCount,
  withoutProjectFilter,
} from "@/lib/issue-list-filters";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { projectIssuesOptions } from "@/data/queries/projects";
import { useWorkspaceStore } from "@/data/workspace-store";
import { groupIssuesByStatus } from "@/lib/group-issues-by-status";
import { useIssueStatuses } from "@/lib/use-issue-statuses";
import { useT } from "@/lib/i18n";
import { useListTotal } from "@/data/queries/list-total";

interface Props {
  projectId: string;
}

export function ProjectRelatedIssues({ projectId }: Props) {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const wsSlug = useWorkspaceStore((s) => s.currentWorkspaceSlug);
  const { t } = useT("issues");
  const { data, isLoading, error, refetch } = useQuery(
    projectIssuesOptions(wsId, projectId),
  );
  const total = useListTotal(projectIssuesOptions(wsId, projectId).queryKey);

  const listFilters = withoutProjectFilter(useIssueListFilters("project", wsId));
  const filtered = useMemo(
    () => filterIssueList(data ?? [], listFilters),
    [data, listFilters],
  );
  const activeFilterCount = issueListFilterCount(listFilters);
  const hasActiveFilters = activeFilterCount > 0;

  const catalog = useIssueStatuses();
  const sections = useMemo(() => groupIssuesByStatus(filtered, catalog.statuses), [filtered, catalog.statuses]);

  const openFilter = () => {
    if (!wsSlug) return;
    router.push({
      pathname: "/[workspace]/issues-filter",
      params: { workspace: wsSlug, scope: "project" },
    });
  };

  const [viewMode, setViewMode] = useIssueViewMode("project");
  // The project page scrolls vertically; the board gets a fixed height.
  const { height } = useWindowDimensions();

  const navigateToIssue = (id: string) => {
    if (wsSlug) router.push(`/${wsSlug}/issue/${id}`);
  };

  if (isLoading) return <IssuesLoading />;

  if (error) {
    return (
      <View className="px-4 py-6 gap-3">
        <Text className="text-sm text-destructive">
          {t("errors.load_failed", {
            message: error instanceof Error ? error.message : "unknown",
          })}
        </Text>
        <Button variant="outline" onPress={() => refetch()}>
          <Text>{t("common:actions.retry")}</Text>
        </Button>
      </View>
    );
  }

  if ((data?.length ?? 0) === 0) {
    return (
      <View className="px-4 py-6">
        <Text className="text-sm text-muted-foreground">{t("list.empty")}</Text>
      </View>
    );
  }

  const toolbar = (
    <>
      <View className="flex-row items-center justify-end gap-2 px-4 pb-2">
        <ViewModeToggle mode={viewMode} onChange={setViewMode} />
        <ProjectFilterButton
          onPress={openFilter}
          activeFilterCount={activeFilterCount}
        />
      </View>
      {hasActiveFilters ? (
        <ActiveFilterChips
          list="project"
          filters={listFilters}
          loadedCount={data?.length ?? 0}
          total={total}
        />
      ) : null}
    </>
  );

  // No match: the same empty state for list and board.
  if (filtered.length === 0) {
    return (
      <View>
        {toolbar}
        <View className="px-4 py-6">
          <Text className="text-sm text-muted-foreground">{t("list.empty")}</Text>
        </View>
      </View>
    );
  }

  // The board gets the filtered issues; only the status filter changes its
  // columns (and lifts hiding Cancelled), like All and My issues.
  if (viewMode === "board") {
    return (
      <View>
        {toolbar}
        <IssueBoard
          issues={filtered}
          loadedCount={data?.length ?? 0}
          total={total}
          filtersActive={hasActiveFilters}
          statusFilters={listFilters.statuses}
          height={Math.round(height * 0.7)}
          onOpenIssue={(issue) => navigateToIssue(issue.id)}
        />
      </View>
    );
  }

  return (
    <View>
      {toolbar}
      {sections.map(({ status, data: issues }) => {
        if (issues.length === 0) return null;
        return (
          <View key={status}>
            <SectionHeader status={status} count={issues.length} />
            {issues.map((issue) => (
              <IssueRow
                key={issue.id}
                issue={issue}
                onPress={() => navigateToIssue(issue.id)}
              />
            ))}
          </View>
        );
      })}
    </View>
  );
}

function SectionHeader({
  status,
  count,
}: {
  status: IssueStatus;
  count: number;
}) {
  const catalog = useIssueStatuses();
  return (
    <View className="flex-row items-center gap-2 px-4 py-2 bg-background">
      <StatusIcon status={status} category={catalog.categoryOf(status)} icon={catalog.iconOf(status)} color={catalog.colorOf(status)} size={14} />
      <Text className="text-xs uppercase tracking-wider text-muted-foreground font-medium">
        {catalog.labelOf(status)}
      </Text>
      <Text className="text-xs text-muted-foreground/60">{count}</Text>
    </View>
  );
}

// Same affordance as the issue-list FilterButton (my-issues.tsx): 44 dp
// outline button with a dot when filters are active.
function ProjectFilterButton({
  onPress,
  activeFilterCount,
}: {
  onPress: () => void;
  /** Number of active filters: dot, and announced by TalkBack. */
  activeFilterCount: number;
}) {
  const hasActiveFilters = activeFilterCount > 0;
  const { t } = useT("issues");
  const { colorScheme } = useColorScheme();
  return (
    <View style={{ position: "relative" }}>
      <Button
        variant="outline"
        size="sm"
        onPress={onPress}
        accessibilityLabel={
          hasActiveFilters
            ? t("filters.button_active", { count: activeFilterCount })
            : t("header_filter")
        }
        accessibilityState={{ selected: hasActiveFilters }}
        className="h-11 w-11 px-0"
        hitSlop={2}
      >
        <Ionicons
          name="options-outline"
          size={16}
          color={THEME[colorScheme].mutedForeground}
        />
      </Button>
      {hasActiveFilters ? (
        <View
          pointerEvents="none"
          className="absolute top-1 right-1 size-1.5 rounded-full bg-brand"
        />
      ) : null}
    </View>
  );
}
