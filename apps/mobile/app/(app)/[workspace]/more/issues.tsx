/**
 * Workspace-wide Issues page. Mirrors web `packages/views/issues/components/
 * issues-page.tsx:32-94`: fetch every issue in the workspace, expose
 * `all / members / agents` scope tabs, group by status, filter by status,
 * priority, project, label and due date.
 *
 * Scope is a **client-side** filter on `assignee_type` — matches web
 * `issues-page.tsx:90-94`. This keeps `issueListOptions(wsId)` workspace-
 * scoped (no scope param on the wire), so `issueKeys.list(wsId)` and
 * `useIssuesRealtime` need no changes.
 *
 * Differences vs My Issues (`(tabs)/my-issues.tsx`):
 *   - Workspace-wide list (all issues), not user-scoped.
 *   - Three scopes are `all / members / agents` (assignee_type pre-filter),
 *     not `assigned / created / agents` (per-user predicates).
 *   - Own filter entry (`useIssueListFilters("all", wsId)`) so workspace-
 *     level filters don't bleed into the per-user view. Filters are kept
 *     per workspace and survive a restart.
 *
 * Not offered on mobile: assignee / creator / custom-property filters
 * (docs/UX.md §3).
 */
import { useMemo } from "react";
import { SectionList, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { Ionicons } from "@/components/ui/ionicons";
import type {
  IssueStatus,
} from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
// Header chrome (back + "Issues" title) comes from the parent Stack
// (`apps/mobile/app/(app)/[workspace]/_layout.tsx:269`). The Filter
// affordance now lives in <ScopeToolbar> below, matching web's
// IssuesHeader pattern (scope + filter share a row).
import { StatusIcon } from "@/components/ui/status-icon";
import { IssueRow } from "@/components/issue/issue-row";
import { IssueBoard } from "@/components/issue/board/issue-board";
import { ViewModeToggle } from "@/components/issue/view-mode-toggle";
import { useIssueViewMode } from "@/data/stores/issue-view-mode-store";
import { IssuesLoading } from "@/components/issue/issues-loading";
import { issueListOptions } from "@/data/queries/issues";
import { useWorkspaceStore } from "@/data/workspace-store";
import {
  useIssuesViewStore,
  type IssuesScope,
} from "@/data/stores/issues-view-store";
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

// Scope tab definitions. Mirrors web `issuesScopeStore`. Counts are NOT
// rendered on the pill labels — web's `IssuesHeader` doesn't show them
// either, and on SE3 (375pt) "(123)" appended to each label pushes the
// row past the safe width when filter icon shares the row. Per-status
// counts still appear on the SectionList headers below.
const SCOPES: IssuesScope[] = ["all", "members", "agents"];

export default function IssuesPage() {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const wsSlug = useWorkspaceStore((s) => s.currentWorkspaceSlug);
  const { t } = useT("issues");

  const scope = useIssuesViewStore((s) => s.scope);
  const setScope = useIssuesViewStore((s) => s.setScope);
  const listFilters = useIssueListFilters("all", wsId);

  const openFilter = () => {
    if (!wsSlug) return;
    router.push({
      pathname: "/[workspace]/issues-filter",
      params: { workspace: wsSlug, scope: "all" },
    });
  };

  const { data, isLoading, error, refetch, isRefetching } = useQuery(
    issueListOptions(wsId),
  );

  const total = useListTotal(issueListOptions(wsId).queryKey);

  // Only the active-filter chips need the catalog — sections group on the
  // category the server already resolved onto each issue. (MUL-6243)
  const catalog = useIssueStatuses();

  // Scope pre-filter — mirrors web `issues-page.tsx:90-94`. Applied before
  // the list filters so chip filters operate on the visible slice.
  const scopedIssues = useMemo(() => {
    const allIssues = data ?? [];
    if (scope === "members") {
      return allIssues.filter((i) => i.assignee_type === "member");
    }
    if (scope === "agents") {
      return allIssues.filter(
        (i) => i.assignee_type === "agent" || i.assignee_type === "squad",
      );
    }
    return allIssues;
  }, [data, scope]);

  const filtered = useMemo(
    () => filterIssueList(scopedIssues, listFilters),
    [scopedIssues, listFilters],
  );

  const sections = useMemo(() => groupIssuesByStatus(filtered, catalog.statuses), [filtered, catalog.statuses]);

  const activeFilterCount = issueListFilterCount(listFilters);
  const hasActiveFilters = activeFilterCount > 0;
  const scopeItems = SCOPES.map((value) => ({
    value,
    label: t(`tabs.${value}`),
  }));

  const [viewMode, setViewMode] = useIssueViewMode("all");

  const showEmptyState = !isLoading && !error && filtered.length === 0;

  return (
    <View className="flex-1 bg-background">
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
          list="all"
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
          refreshing={isRefetching}
          onRefresh={() => guardedRefresh(refetch)}
        />
      )}
    </View>
  );
}

/**
 * Outline icon button matching the pill height. Identical to the helper in
 * `(tabs)/my-issues.tsx` for the same reason ScopeToolbar is duplicated:
 * two callers don't justify a shared primitive yet.
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
            : t("filters.title")
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
 * Toolbar row mirroring web `IssuesHeader`
 * (`packages/views/issues/components/issues-header.tsx:516-543`): left-aligned
 * scope pill group + right-side Filter icon (red dot on active filters).
 * Identical to the equivalent in `(tabs)/my-issues.tsx` — kept duplicated
 * because the threshold for a shared `components/ui/` primitive is 3 callers,
 * and two callers don't justify the abstraction yet.
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
