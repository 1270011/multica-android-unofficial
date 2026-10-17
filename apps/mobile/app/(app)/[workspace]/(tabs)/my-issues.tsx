/**
 * "My Issues" tab. Three scopes — assigned / created / agents — mirroring
 * web's `packages/views/my-issues/components/my-issues-page.tsx:48-65`. The
 * `agents` scope label is "Agents and Squads" because the backend predicate
 * (`involves_user_id`, MUL-2397) surfaces both the user's owned agents and
 * squads they're involved in (member / leader / has an owned agent inside).
 *
 * Issues are grouped by concrete status key; empty sections are omitted.
 * Category controls lifecycle behavior and ordering, not section identity.
 *
 * Filters (status, priority, project, label, due date) live in
 * `useIssueListFilterStore` per list and workspace and survive a restart
 *; the scope tab stays in `useMyIssuesViewStore`.
 */
import { useMemo } from "react";
import { SectionList, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useIsFocused } from "@react-navigation/native";
import { router } from "expo-router";
import { Ionicons } from "@/components/ui/ionicons";
import type {
  IssueStatus,
} from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { Header } from "@/components/ui/header";
import { HeaderActions } from "@/components/ui/app-header-actions";
import { StatusIcon } from "@/components/ui/status-icon";
import { IssueRow } from "@/components/issue/issue-row";
import { IssueBoard } from "@/components/issue/board/issue-board";
import { ViewModeToggle } from "@/components/issue/view-mode-toggle";
import { useIssueViewMode } from "@/data/stores/issue-view-mode-store";
import { IssuesLoading } from "@/components/issue/issues-loading";
import {
  buildMyIssuesFilter,
  myIssueListOptions,
} from "@/data/queries/my-issues";
import type { MyIssuesScope } from "@/data/queries/issue-keys";
import { useAuthStore } from "@/data/auth-store";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useMyIssuesViewStore } from "@/data/stores/my-issues-view-store";
import { useT } from "@/lib/i18n";
import { useIssueStatuses } from "@/lib/use-issue-statuses";
import { groupIssuesByStatus } from "@/lib/group-issues-by-status";
import { filterIssueList, issueListFilterCount } from "@/lib/issue-list-filters";
import { useIssueListFilters } from "@/data/stores/issue-list-filter-store";
import { ActiveFilterChips } from "@/components/issue/active-filter-chips";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { guardedRefresh } from "@/lib/refresh-guard";
import { useListTotal } from "@/data/queries/list-total";

// Mobile pill row has tight width on SE3 (375pt). Three pills + Filter icon
// must fit in 343pt usable space, so the agents scope renders "Agents" — the
// full "Agents and Squads" label (~135pt) blows past safe limits and breaks
// under Dynamic Type. Semantics unchanged: same backend predicate
// (`involves_user_id`, MUL-2397) covers owned agents + related squads; the
// empty state copy still says "agents or squads".
const SCOPES: MyIssuesScope[] = ["assigned", "created", "agents"];

export default function MyIssues() {
  const isFocused = useIsFocused();
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const wsSlug = useWorkspaceStore((s) => s.currentWorkspaceSlug);
  const { t } = useT("issues");

  const scope = useMyIssuesViewStore((s) => s.scope);
  const setScope = useMyIssuesViewStore((s) => s.setScope);
  const listFilters = useIssueListFilters("my", wsId);

  const openFilter = () => {
    if (!wsSlug) return;
    router.push({
      pathname: "/[workspace]/issues-filter",
      params: { workspace: wsSlug, scope: "my" },
    });
  };

  const filter = useMemo(
    () => (userId ? buildMyIssuesFilter(scope, userId) : { assignee_id: "" }),
    [scope, userId],
  );

  const { data, isLoading, error, refetch, isRefetching } = useQuery({
    ...myIssueListOptions(wsId, scope, filter),
    enabled: !!wsId && !!userId,
  });

  const total = useListTotal(myIssueListOptions(wsId, scope, filter).queryKey);

  // Catalog labels and ordering enhance exact-key sections without blocking rows.
  const catalog = useIssueStatuses();

  // Client-side filters, see lib/issue-list-filters.ts (web parity with
  // packages/views/issues/utils/filter.ts plus the due-date filter).
  const filtered = useMemo(
    () => filterIssueList(data ?? [], listFilters),
    [data, listFilters],
  );

  const sections = useMemo(() => groupIssuesByStatus(filtered, catalog.statuses), [filtered, catalog.statuses]);

  const activeFilterCount = issueListFilterCount(listFilters);
  const hasActiveFilters = activeFilterCount > 0;
  const scopeItems = SCOPES.map((value) => ({
    value,
    label: t(`tabs.${value}`),
  }));

  const [viewMode, setViewMode] = useIssueViewMode("my");

  const showEmptyState =
    !isLoading && !error && filtered.length === 0;

  return (
    <View className="flex-1 bg-background">
      <Header title={t("navigation:tabs.my_issues")} right={<HeaderActions />} />
      <ScopeToolbar
        scopes={scopeItems}
        scope={scope}
        onChange={(v) => setScope(v)}
        onOpenFilter={openFilter}
        activeFilterCount={activeFilterCount}
      />
      <View className="flex-row justify-end px-4 pb-2">
        <ViewModeToggle mode={viewMode} onChange={setViewMode} />
      </View>
      {hasActiveFilters ? (
        <ActiveFilterChips
          list="my"
          filters={listFilters}
          loadedCount={data?.length ?? 0}
          total={total}
        />
      ) : null}
      {isLoading ? (
        <IssuesLoading />
      ) : error ? (
        <View className="px-4 gap-3 pt-4">
          <Text className="text-sm text-destructive">
            {t("errors.load_failed", {
              message: error instanceof Error ? error.message : "unknown",
            })}
          </Text>
          <Button variant="outline" onPress={() => refetch()}>
            <Text>{t("common:actions.retry")}</Text>
          </Button>
        </View>
      ) : showEmptyState ? (
        <EmptyState
          message={
            hasActiveFilters
              ? t("empty.filtered")
              : t(`empty.${scope}`)
          }
        />
      ) : viewMode === "board" ? (
        <IssueBoard
          issues={filtered}
          loadedCount={data?.length ?? 0}
          total={total}
          filtersActive={hasActiveFilters}
          statusFilters={listFilters.statuses}
          onOpenIssue={(issue) => {
            if (wsSlug) router.push(`/${wsSlug}/issue/${issue.id}`);
          }}
        />
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item) => item.id}
          stickySectionHeadersEnabled={false}
          ItemSeparatorComponent={() => (
            <View className="h-px bg-border ml-4" />
          )}
          renderSectionHeader={({ section }) => (
            <SectionHeader
              status={section.status}
              count={section.data.length}
            />
          )}
          contentContainerClassName="pb-6"
          renderItem={({ item }) => (
            <IssueRow
              issue={item}
              onPress={() => {
                if (wsSlug) router.push(`/${wsSlug}/issue/${item.id}`);
              }}
            />
          )}
          refreshing={isFocused && isRefetching}
          onRefresh={() => guardedRefresh(refetch)}
        />
      )}

    </View>
  );
}

/**
 * Outline icon button matching the pill height so the toolbar row reads as
 * one visual group. Mirrors web `IssuesHeader` / `MyIssuesHeader` filter
 * trigger (`packages/views/my-issues/components/my-issues-header.tsx:174`),
 * which is also `variant="outline"` + icon-sized — NOT the ghost-style we'd
 * get from <IconButton>. Square (`w-9`) with `px-0` to suppress the sm
 * default `px-3`.
 */
function FilterButton({
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
    <View style={{ position: "relative" }} className="ml-2">
      <Button
        variant="outline"
        size="sm"
        onPress={onPress}
        accessibilityLabel={
          hasActiveFilters
            ? t("filters.button_active", { count: activeFilterCount })
            : t("header_filter")
        }
        // 44 dp + 2 dp hit-slop = 48 dp touch target.
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

/**
 * Toolbar row mirroring web `MyIssuesHeader` / `IssuesHeader`
 * (`packages/views/my-issues/components/my-issues-header.tsx:138-163`):
 * left-aligned scope pill group + right-side Filter icon (red dot when
 * filters are active). Replaces the previous full-width segmented tabs +
 * Filter-in-title-bar split — keeps scope and the filter affordance in the
 * same row, because they both control the list directly below.
 */
function ScopeToolbar<S extends string>({
  scopes,
  scope,
  onChange,
  onOpenFilter,
  activeFilterCount,
}: {
  scopes: { value: S; label: string }[];
  scope: S;
  onChange: (value: S) => void;
  onOpenFilter: () => void;
  /** Number of active filters: dot, and announced by TalkBack. */
  activeFilterCount: number;
}) {
  return (
    // Scope pills wrap at large font sizes instead of running under the
    // filter button.
    <View className="flex-row items-center justify-between gap-2 px-4 pt-2 pb-2">
      <View className="flex-1 flex-row flex-wrap items-center gap-1 min-w-0">
        {scopes.map((s) => {
          const active = scope === s.value;
          return (
            <Button
              key={s.value}
              variant="outline"
              size="sm"
              onPress={() => onChange(s.value)}
              className={active ? "bg-accent" : ""}
              accessibilityState={{ selected: active }}
            >
              <Text
                numberOfLines={1}
                className={active ? "text-accent-foreground" : "text-muted-foreground"}
              >
                {s.label}
              </Text>
            </Button>
          );
        })}
      </View>
      <FilterButton
        onPress={onOpenFilter}
        activeFilterCount={activeFilterCount}
      />
    </View>
  );
}



// The section header names its concrete built-in or custom status.
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
      {/* Category keys resolve to their canonical lifecycle glyph. */}
      <StatusIcon status={status} category={catalog.categoryOf(status)} icon={catalog.iconOf(status)} color={catalog.colorOf(status)} size={14} />
      <Text className="text-xs uppercase tracking-wider text-muted-foreground font-medium">
        {catalog.labelOf(status)}
      </Text>
      <Text className="text-xs text-muted-foreground/60">{count}</Text>
    </View>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <View className="flex-1 items-center justify-center px-6">
      <Text className="text-sm text-muted-foreground text-center">
        {message}
      </Text>
    </View>
  );
}
