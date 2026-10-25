/**
 * "My Issues" tab. Three tabs — assigned / created / all. "All" is the whole workspace; the
 * former "Agents" tab is the filter "My agents and squads" (`involvesMe`,
 * backend predicate `involves_user_id`, MUL-2397), applied in Created and
 * All.
 *
 * Issues are grouped by concrete status key; empty sections are omitted.
 * Category controls lifecycle behavior and ordering, not section identity.
 *
 * Filters (status, priority, project, label, due date) live in
 * `useIssueListFilterStore` per list and workspace and survive a restart
 *The tab is remembered per workspace in
 * `useMyIssuesViewStore`. The sort goes to the server; the
 * status groups keep the server order. `?tab=<scope>` opens a tab directly; the old
 * route `more/issues` redirects here with `tab=all`.
 *
 * Selection mode: long press or the TalkBack action
 * "Select" on a row starts it; taps then toggle rows. It ends on back, ✕,
 * tab change, switching between list and board and leaving the screen. A
 * filter or list change keeps only the issues that are still visible.
 * The header menu ⋮ → "Select" starts it empty in list and board (D5b, the
 * only way in on the board, whose long press is the status menu / drag);
 * on the board taps then toggle cards and dragging is off.
 *
 * Title filter: the stored regex hides matching titles in
 * every tab, list and board, as the last step after the other filters; a
 * hint row below the chips counts them and "Show" lifts it for this screen
 * (lib/use-title-filter.ts).
 *
 * Low windows (< 480 dp, small phone in landscape): tabs, view
 * bar, filter chips and sort row scroll with the list, see
 * lib/issue-list-layout.ts.
 */
import { useEffect, useMemo, useState } from "react";
import { BackHandler, SectionList, View, useWindowDimensions } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useIsFocused } from "@react-navigation/native";
import { router, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@/components/ui/ionicons";
import type {
  IssueStatus,
} from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { Header } from "@/components/ui/header";
import { IconButton } from "@/components/ui/icon-button";
import { showActionSheet } from "@/lib/action-sheet";
import { HeaderActions } from "@/components/ui/app-header-actions";
import { StatusIcon } from "@/components/ui/status-icon";
import { IssueRow } from "@/components/issue/issue-row";
import { IssueBoard } from "@/components/issue/board/issue-board";
import { ViewModeToggle } from "@/components/issue/view-mode-toggle";
import { IssueViewBar } from "@/components/issue/issue-view-bar";
import { showViewConflictDialog } from "@/components/issue/view-conflict-dialog";
import {
  useCanManageView,
  useDropGoneActiveView,
  useIssueViewActions,
} from "@/data/use-issue-view-actions";
import { issueViewKeys } from "@/data/queries/issue-views";
import {
  canSaveIntoView,
  isViewModified,
  viewUpdateErrorKind,
} from "@/lib/issue-view-edit";
import {
  useActiveIssueView,
  useActiveIssueViewStore,
} from "@/data/stores/active-issue-view-store";
import { useIssueViewMode } from "@/data/stores/issue-view-mode-store";
import { IssuesLoading } from "@/components/issue/issues-loading";
import {
  lockFiltersForScope,
  myIssueListOptions,
  toListParams,
} from "@/data/queries/my-issues";
import { isMyIssuesScope, MY_ISSUES_SCOPES } from "@/data/queries/issue-keys";
import { useAuthStore } from "@/data/auth-store";
import { ApiError } from "@/data/api";
import { sectionsForBadRequest } from "@/lib/actor-filter-options";
import { showToast } from "@/lib/toast";
import { runWhileOnline, useIsOnline } from "@/lib/network-status";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useMyIssuesScope } from "@/data/stores/my-issues-view-store";
import { useT } from "@/lib/i18n";
import { useIssueStatuses } from "@/lib/use-issue-statuses";
import { groupIssuesByStatus } from "@/lib/group-issues-by-status";
import { filterIssueList, issueListFilterCount } from "@/lib/issue-list-filters";
import { listControlsScroll, showResetFilters } from "@/lib/issue-list-layout";
import {
  useIssueListFilters,
  useIssueListFilterStore,
  useIssueListSort,
} from "@/data/stores/issue-list-filter-store";
import { SortedByRow } from "@/components/issue/sort-section";
import { isSortBadRequest, MANUAL_SORT } from "@/lib/issue-list-sort";
import { ActiveFilterChips } from "@/components/issue/active-filter-chips";
import { IssueSelectionHeader } from "@/components/issue/issue-selection-header";
import { IssueSelectionActions } from "@/components/issue/issue-selection-actions";
import {
  allSelected,
  useIssueSelectionStore,
} from "@/data/stores/issue-selection-store";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { guardedRefresh } from "@/lib/refresh-guard";
import { useListTotal } from "@/data/queries/list-total";
import { issueKeys } from "@/data/queries/issue-keys";
import { useRefreshOnFocus } from "@/lib/use-refresh-on-focus";
import { READING_WIDTH_STYLE } from "@/components/ui/reading-width";
import { TitleFilterAllHidden, TitleFilterHint } from "@/components/issue/title-filter-hint";
import { useTitleFilteredIssues } from "@/lib/use-title-filter";
import { allHiddenByTitle } from "@/lib/issue-title-filter";

export default function MyIssues() {
  const isFocused = useIsFocused();
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const wsSlug = useWorkspaceStore((s) => s.currentWorkspaceSlug);
  const { t } = useT("issues");

  const [scope, setScope] = useMyIssuesScope(wsId);
  const { tab } = useLocalSearchParams<{ tab?: string }>();
  useEffect(() => {
    if (!wsId || !isMyIssuesScope(tab)) return;
    setScope(tab);
    // Applied once; later tab changes are the user's.
    router.setParams({ tab: undefined });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- setScope is rebuilt every render
  }, [tab, wsId]);
  const storedFilters = useIssueListFilters("my", wsId);
  // Server-side sort; part of the query key like the filters.
  const sort = useIssueListSort("my", wsId);
  // Assigned is fixed to me as assignee, Created as creator (D3a).
  const listFilters = useMemo(
    () => lockFiltersForScope(storedFilters, scope),
    [scope, storedFilters],
  );

  const openFilter = (section?: "sort") => {
    if (!wsSlug) return;
    router.push({
      pathname: "/[workspace]/issues-filter",
      params: { workspace: wsSlug, scope: "my", ...(section ? { section } : {}) },
    });
  };

  // Assignee and creator filters go to the server (total, paging); the
  // object is part of the query key, so live refresh via myAll reaches it.
  const filter = useMemo(
    () =>
      userId ? toListParams(scope, userId, listFilters, sort) : { assignee_id: "" },
    [scope, userId, listFilters, sort],
  );

  const { data, isLoading, error, refetch, isRefetching } = useQuery({
    ...myIssueListOptions(wsId, scope, filter),
    enabled: !!wsId && !!userId,
  });
  useRefreshOnFocus([issueKeys.myAll(wsId)]);

  // 400 for the server-side filters (spec §2 "Zustände"): reset the named
  // section and say so, instead of a load error that the user can't fix.
  useEffect(() => {
    if (!wsId || !(error instanceof ApiError) || error.status !== 400) return;
    // The Go server sends {"error": "invalid assignee_types"}.
    const body = error.body as { error?: unknown } | undefined;
    const message = `${error.message} ${typeof body?.error === "string" ? body.error : ""}`;
    const store = useIssueListFilterStore.getState();
    // "invalid sort value" / "invalid direction value": back to "Manual".
    if (isSortBadRequest(message)) {
      store.setSort("my", wsId, MANUAL_SORT);
      showToast({ key: "issues:sort.reset" });
      return;
    }
    const sections = sectionsForBadRequest(message, listFilters);
    if (sections.length === 0) return;
    for (const section of sections) store.clearSection("my", wsId, section);
    showToast({ key: "issues:filters.section_reset" });
  }, [error, listFilters, wsId]);

  const total = useListTotal(myIssueListOptions(wsId, scope, filter).queryKey);

  // Catalog labels and ordering enhance exact-key sections without blocking rows.
  const catalog = useIssueStatuses();

  // Client-side filters, see lib/issue-list-filters.ts (web parity with
  // packages/views/issues/utils/filter.ts plus the due-date filter).
  const listFiltered = useMemo(
    () => filterIssueList(data ?? [], listFilters),
    [data, listFilters],
  );
  // Title filter last, so list, board columns and hint count the same.
  const titleFilter = useTitleFilteredIssues(wsId, listFiltered);
  const filtered = titleFilter.issues;

  const sections = useMemo(() => groupIssuesByStatus(filtered, catalog.statuses), [filtered, catalog.statuses]);

  const activeFilterCount = issueListFilterCount(listFilters);
  const hasActiveFilters = activeFilterCount > 0;
  const scopeItems = MY_ISSUES_SCOPES.map((value) => ({
    value,
    label: t(`tabs.${value}`),
  }));

  const [viewMode, setViewMode] = useIssueViewMode("my");
  // Saved view: name in the view bar, sheet "Ansichten".
  const activeView = useActiveIssueView(wsId);
  useDropGoneActiveView(activeView?.id ?? null);
  const openViews = () => {
    if (!wsSlug) return;
    router.push({
      pathname: "/[workspace]/issue-views",
      params: { workspace: wsSlug, tab: scope },
    });
  };
  // "· geändert" + Speichern/Verwerfen (D8c).
  const qc = useQueryClient();
  const { applyView, exitView, saveActiveView, discardChanges } = useIssueViewActions();
  const canManage = useCanManageView();
  const [savingView, setSavingView] = useState(false);
  const online = useIsOnline();
  const screenState = useMemo(
    () => ({ tab: scope, filters: storedFilters, sort, viewMode }),
    [scope, storedFilters, sort, viewMode],
  );
  const viewModified = activeView ? isViewModified(activeView.applied, screenState) : false;
  const canSaveView =
    !!activeView &&
    canManage(activeView.view) &&
    canSaveIntoView(activeView.view, screenState);
  const onSaveView = async () => {
    // Offline Save is disabled; nothing is queued.
    if (!activeView || savingView || !online) return;
    const { id, name } = activeView;
    setSavingView(true);
    try {
      await runWhileOnline(saveActiveView);
      showToast({ key: "issues:views.edit.saved", params: { name } });
    } catch (err) {
      const kind = viewUpdateErrorKind(err);
      if (kind === "conflict") {
        showViewConflictDialog(t, "save", {
          reload: () => void applyView(id),
          save_as_new: () => {
            if (!wsSlug) return;
            router.push({
              pathname: "/[workspace]/issue-view-create",
              params: { workspace: wsSlug, tab: scope },
            });
          },
        });
      } else if (kind === "gone") {
        showToast({ key: "issues:views.gone" });
        exitView();
        void qc.invalidateQueries({ queryKey: issueViewKeys.all(wsId) });
      } else if (kind === "forbidden") {
        showToast({ key: "issues:views.create.error_forbidden" });
        void qc.invalidateQueries({ queryKey: issueViewKeys.all(wsId) });
      } else {
        showToast({ key: `issues:views.edit.error_${kind === "offline" ? "offline" : "failed"}` });
      }
    } finally {
      setSavingView(false);
    }
  };

  const showEmptyState =
    !isLoading && !error && filtered.length === 0;
  const allTitleHidden = allHiddenByTitle(
    listFiltered.length,
    filtered.length,
    titleFilter.hidden,
  );
  const { height: windowHeight } = useWindowDimensions();
  const controlsInList =
    !isLoading && !error && !showEmptyState && listControlsScroll(windowHeight, viewMode);

  const selecting = useIssueSelectionStore((s) => s.active);
  const selectedIds = useIssueSelectionStore((s) => s.ids);
  const selection = useIssueSelectionStore.getState;
  const visibleIds = useMemo(() => filtered.map((i) => i.id), [filtered]);
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  useEffect(() => {
    selection().prune(visibleIds);
  }, [selection, visibleIds]);
  useEffect(() => {
    selection().reset();
  }, [selection, scope, wsId, viewMode]);
  useEffect(() => {
    // A batch picker sheet on top blurs the list but keeps the selection.
    if (!isFocused && !selection().pickerOpen) selection().reset();
  }, [selection, isFocused]);
  useEffect(() => {
    if (!selecting || !isFocused) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      selection().reset();
      return true;
    });
    return () => sub.remove();
  }, [selection, selecting, isFocused]);

  // Tabs, view bar, chips and sort row: fixed on top, or the list header on
  // low windows (B3; with only the last three scrolling, the selection mode
  // still showed just two rows on 640×384 dp).
  const listControls = (
    <>
        <ScopeToolbar
          scopes={scopeItems}
          scope={scope}
          onChange={(v) => {
            // A view belongs to its tab; the filters stay, the name goes.
            if (wsId && v !== scope) useActiveIssueViewStore.getState().forget(wsId);
            setScope(v);
          }}
          onOpenFilter={() => openFilter()}
          activeFilterCount={activeFilterCount}
        />
        <IssueViewBar
          active={activeView}
          onOpen={openViews}
          modified={viewModified}
          canSave={canSaveView}
          saving={savingView}
          offline={!online}
          onSave={() => void onSaveView()}
          onDiscard={discardChanges}
          right={<ViewModeToggle mode={viewMode} onChange={setViewMode} />}
        />
        {hasActiveFilters ? (
          <ActiveFilterChips
            list="my"
            filters={listFilters}
            loadedCount={data?.length ?? 0}
            total={total}
          />
        ) : null}
        {allTitleHidden ? null : (
          <TitleFilterHint
            hidden={titleFilter.hidden}
            revealed={titleFilter.revealed}
            onToggle={titleFilter.toggleReveal}
          />
        )}
        <SortedByRow sort={sort} onPress={() => openFilter("sort")} />
    </>
  );

  return (
    <View className="flex-1 bg-background">
      {selecting ? (
        <IssueSelectionHeader
          count={selectedIds.length}
          visibleCount={visibleIds.length}
          total={
            total !== undefined && total > (data?.length ?? 0) ? total : undefined
          }
          allSelected={allSelected(selectedIds, visibleIds)}
          onToggleAll={() => selection().toggleAll(visibleIds)}
          onCancel={() => selection().reset()}
        />
      ) : (
        <Header
          title={t("navigation:tabs.my_issues")}
          right={
            <>
              <HeaderActions />
              <IconButton
                name="ellipsis-vertical"
                onPress={() => openListMenu(t, () => selection().begin())}
                accessibilityLabel={t("selection.menu")}
                testID="my-issues-menu"
              />
            </>
          }
        />
      )}
      {controlsInList ? null : listControls}
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
      ) : allTitleHidden ? (
        <TitleFilterAllHidden onShow={titleFilter.toggleReveal} />
      ) : showEmptyState ? (
        <EmptyState
          message={
            hasActiveFilters
              ? t("empty.filtered")
              : t(`empty.${scope}`)
          }
          // Spec §1 "Leer, mit Filter": resets the filters; tab and sort stay.
          onResetFilters={
            wsId && showResetFilters(showEmptyState, activeFilterCount)
              ? () => useIssueListFilterStore.getState().clear("my", wsId)
              : undefined
          }
        />
      ) : viewMode === "board" ? (
        <IssueBoard
          issues={filtered}
          loadedCount={data?.length ?? 0}
          total={total}
          filtersActive={hasActiveFilters}
          statusFilters={listFilters.statuses}
          sort={sort}
          onOpenIssue={(issue) => {
            if (wsSlug) router.push(`/${wsSlug}/issue/${issue.id}`);
          }}
          selection={
            selecting
              ? { ids: selectedSet, onToggle: (issue) => selection().toggle(issue.id) }
              : undefined
          }
        />
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item) => item.id}
          stickySectionHeadersEnabled={false}
          ListHeaderComponent={controlsInList ? listControls : undefined}
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
          contentContainerStyle={READING_WIDTH_STYLE}
          extraData={selectedSet}
          renderItem={({ item }) => (
            <IssueRow
              issue={item}
              selected={selecting ? selectedSet.has(item.id) : undefined}
              onSelect={() => selection().start(item.id)}
              onPress={() => {
                if (selecting) selection().toggle(item.id);
                else if (wsSlug) router.push(`/${wsSlug}/issue/${item.id}`);
              }}
            />
          )}
          refreshing={isFocused && isRefetching}
          onRefresh={() => guardedRefresh(refetch)}
        />
      )}
      {selecting ? <IssueSelectionActions wsSlug={wsSlug} /> : null}
    </View>
  );
}

/** Header menu ⋮ of list and board: "Select" (D5b). */
function openListMenu(t: ReturnType<typeof useT>["t"], onSelect: () => void) {
  showActionSheet(
    {
      options: [t("common:actions.cancel"), t("selection.select")],
      cancelButtonIndex: 0,
    },
    (i) => {
      if (i === 1) onSelect();
    },
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
    // filter button (200 %).
    <View className="flex-row items-center justify-between gap-2 px-4 pt-2 pb-2">
      <View
        role="tablist"
        className="flex-1 flex-row flex-wrap items-center gap-2 min-w-0"
      >
        {scopes.map((s) => {
          const active = scope === s.value;
          return (
            <Button
              key={s.value}
              variant="outline"
              size="sm"
              onPress={() => onChange(s.value)}
              // 44 dp + 2 dp hit-slop = 48 dp touch target.
              className={active ? "h-11 min-w-11 bg-accent" : "h-11 min-w-11"}
              hitSlop={2}
              // `role` (not accessibilityRole): Button sets role="button",
              // which would win over accessibilityRole.
              role="tab"
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

function EmptyState({
  message,
  onResetFilters,
}: {
  message: string;
  /** Shown as "Filter zurücksetzen" below the text (empty list with filters). */
  onResetFilters?: () => void;
}) {
  const { t } = useT("issues");
  return (
    <View className="flex-1 items-center justify-center gap-3 px-6">
      <Text className="text-sm text-muted-foreground text-center">
        {message}
      </Text>
      {onResetFilters ? (
        <Button
          variant="outline"
          onPress={onResetFilters}
          // 44 dp + 2 dp hit-slop = 48 dp touch target.
          className="h-11"
          hitSlop={2}
          testID="issues-empty-reset-filters"
        >
          <Text>{t("filters.clear")}</Text>
        </Button>
      ) : null}
    </View>
  );
}
