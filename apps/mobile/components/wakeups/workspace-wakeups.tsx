/**
 * Segment "Wakeups" of the Autopilots page; web counterpart workspace-wakeups.tsx.
 *
 * - Scope chips with the server's `counts`, a filter sheet (trigger, agent,
 *   source) and a debounced search; all of them are query parameters of
 *   `GET /api/issue-wakeups` (lib/wakeup-overview.ts `overviewQuery`).
 * - Paging: 50 per page, the next page loads at the end of the list; the
 *   footer says "{n} of {total}".
 * - Banner when the platform paused rules (`GET /api/issue-wakeup-paused`),
 *   tapping it switches to the "Paused" scope.
 * - Row tap opens the issue at its "Wakeups" section (`section=wakeups`).
 *   Switch, "⋯", long-press and TalkBack actions as on the issue, only
 *   with `can_manage`. The overview has no instruction text (the server
 *   leaves it out); "Edit instruction" loads it on the issue's sheet.
 * - Bulk "Turn off": long-press or the TalkBack action
 *   "Select" starts selection mode, a bar shows "{n} selected · Turn off ·
 *   Cancel". Only rows with `can_manage` that are on can be selected
 *   (lib/wakeup-bulk.ts). Failed rows stay selected after the run, a toast
 *   says "{ok} of {total} turned off". Cancel, the back button and any
 *   filter change empty the selection.
 */
import { useCallback, useEffect, useMemo, useReducer, useState } from "react";
import { ActivityIndicator, Alert, BackHandler, FlatList, Modal, Pressable, ScrollView, View } from "react-native";
import { router } from "expo-router";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Ionicons } from "@/components/ui/ionicons";
import { SegmentedPills } from "@/components/ui/segmented-pills";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Text } from "@/components/ui/text";
import { TextField } from "@/components/ui/text-field";
import { ListOffline } from "@/components/ui/list-offline";
import { listState } from "@/lib/list-state";
import { useWakeupMenu } from "@/components/issue/use-wakeup-menu";
import { useDisableWorkspaceWakeups } from "@/data/mutations/wakeups";
import { pausedWakeupsOptions, wakeupKeys, workspaceWakeupsPagedOptions } from "@/data/queries/wakeups";
import type { MobileWorkspaceWakeup } from "@/data/wakeup-schemas";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useActorLookup } from "@/data/use-actor-name";
import { useT } from "@/lib/i18n";
import { i18n } from "@/lib/i18n/singleton";
import { guardedRefresh } from "@/lib/refresh-guard";
import { continuousCorners } from "@/lib/radius";
import { THEME } from "@/lib/theme";
import { useColorScheme } from "@/lib/use-color-scheme";
import { useIssueStatuses } from "@/lib/use-issue-statuses";
import { useRefreshOnFocus } from "@/lib/use-refresh-on-focus";
import { showToast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import {
  DEFAULT_OVERVIEW_FILTERS,
  OVERVIEW_KINDS,
  OVERVIEW_SCOPES,
  OVERVIEW_SEARCH_DEBOUNCE_MS,
  OVERVIEW_SOURCES,
  activeFilterCount,
  isSystemRow,
  overviewEmptyKind,
  overviewRowActions,
  overviewRowKey,
  overviewRows,
  overviewSwitchState,
  pausedBannerCount,
  wakeupIssueHref,
  type OverviewFilterState,
} from "@/lib/wakeup-overview";
import { bulkSelectionReducer, bulkToast, isBulkSelectable, selectedRows } from "@/lib/wakeup-bulk";
import {
  WAKEUP_ICON_NAME,
  wakeupIcon,
  wakeupPausedText,
  wakeupSourceText,
  wakeupTriggerText,
  type WakeupNames,
} from "@/lib/wakeup-text";

export function WorkspaceWakeups() {
  const { t } = useT("issues");
  const { colorScheme } = useColorScheme();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const [filters, setFilters] = useState<OverviewFilterState>(DEFAULT_OVERVIEW_FILTERS);
  const [searchInput, setSearchInput] = useState("");
  const [sheetOpen, setSheetOpen] = useState(false);

  // 300 ms debounce: the query key changes only after typing stops.
  useEffect(() => {
    const id = setTimeout(
      () => setFilters((f) => (f.search === searchInput ? f : { ...f, search: searchInput })),
      OVERVIEW_SEARCH_DEBOUNCE_MS,
    );
    return () => clearTimeout(id);
  }, [searchInput]);

  const list = useInfiniteQuery(workspaceWakeupsPagedOptions(wsId, filters));
  const paused = useQuery(pausedWakeupsOptions(wsId));
  useRefreshOnFocus([wakeupKeys.workspaceAll(wsId), wakeupKeys.paused(wsId)]);

  const pages = list.data?.pages;
  const rows = useMemo(() => overviewRows(pages), [pages]);
  const first = pages?.[0];
  const counts = first?.counts;
  const total = first?.total ?? 0;
  const agents = first?.agents ?? [];
  const pausedCount = pausedBannerCount(paused.data);
  const filterCount = activeFilterCount(filters);

  const { getName } = useActorLookup();
  const { labelOf } = useIssueStatuses();
  const names = useMemo<WakeupNames>(
    () => ({ status: labelOf, actor: (type, id) => getName(type as never, id) ?? undefined }),
    [labelOf, getName],
  );
  // Rules the server answered 403 for: their actions vanish.
  const [forbidden, setForbidden] = useState<ReadonlySet<string>>(() => new Set());
  const onForbidden = useCallback(
    (id: string) => setForbidden((prev) => (prev.has(id) ? prev : new Set(prev).add(id))),
    [],
  );

  const reset = () => {
    setSearchInput("");
    setFilters(DEFAULT_OVERVIEW_FILTERS);
  };

  // Bulk "Turn off". Selection mode = at least one row selected.
  const [selected, dispatchSelection] = useReducer(bulkSelectionReducer, EMPTY_SELECTION);
  const selecting = selected.size > 0;
  const bulk = useDisableWorkspaceWakeups();
  const cancelSelection = useCallback(() => dispatchSelection({ type: "cancel" }), []);
  const toggleSelected = useCallback(
    (w: MobileWorkspaceWakeup) =>
      dispatchSelection({ type: "toggle", row: w, forbidden: forbidden.has(w.id) }),
    [forbidden],
  );
  // Other filters show other rows: the selection would be invisible.
  useEffect(() => cancelSelection(), [filters, cancelSelection]);
  // After a refetch, switched-off or vanished rows leave the selection.
  useEffect(() => dispatchSelection({ type: "prune", rows, forbidden }), [rows, forbidden]);
  useEffect(() => {
    if (!selecting) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (!bulk.isPending) cancelSelection();
      return true;
    });
    return () => sub.remove();
  }, [selecting, bulk.isPending, cancelSelection]);

  const confirmBulk = () => {
    const picked = selectedRows(rows, selected);
    if (picked.length === 0) return;
    Alert.alert(
      t("wakeups.bulk.confirm_title", { count: picked.length }),
      t("wakeups.bulk.confirm_body"),
      [
        { text: t("common:actions.cancel"), style: "cancel" },
        {
          text: t("wakeups.bulk.confirm"),
          style: "destructive",
          onPress: () => {
            bulk.mutateAsync(picked).then((result) => {
              result.forbidden.forEach(onForbidden);
              dispatchSelection({ type: "result", result });
              const toast = bulkToast(result);
              showToast(t(toast.key, toast.values));
            });
          },
        },
      ],
      { cancelable: true },
    );
  };

  const header = (
    <View>
      {list.error && pages ? (
        <View className="mx-4 mt-2 rounded-md bg-destructive/10 px-3 py-2" accessibilityLiveRegion="polite">
          <Text className="text-xs text-destructive">{t("wakeups.overview.refresh_failed")}</Text>
        </View>
      ) : null}
      {pausedCount ? (
        <Pressable
          onPress={() => setFilters((f) => ({ ...f, scope: "paused" }))}
          accessibilityRole="button"
          className="mx-4 mt-2 flex-row items-center gap-2 rounded-md bg-secondary px-3 py-2 min-h-12"
          testID="wakeups-paused-banner"
        >
          <Ionicons name="pause-circle-outline" size={18} color={THEME[colorScheme].mutedForeground} />
          <Text className="flex-1 text-sm text-foreground">
            {t("wakeups.overview.paused_banner", { count: pausedCount })}
          </Text>
        </Pressable>
      ) : null}
      <SegmentedPills
        items={OVERVIEW_SCOPES.map((scope) => ({
          value: scope,
          label: t(`wakeups.overview.scope.${scope}`),
          badge: counts?.[scope],
          testID: `wakeups-scope-${scope}`,
        }))}
        value={filters.scope}
        onChange={(scope) => setFilters((f) => ({ ...f, scope }))}
      />
      <View className="flex-row flex-wrap items-center gap-2 px-4 pb-2">
        <TextField
          className="flex-1 min-w-[160px]"
          value={searchInput}
          onChangeText={setSearchInput}
          placeholder={t("wakeups.overview.search_placeholder")}
          accessibilityLabel={t("wakeups.overview.search_label")}
          autoCorrect={false}
          returnKeyType="search"
          testID="wakeups-search"
        />
        {searchInput ? (
          <IconButton
            name="close-circle"
            onPress={() => setSearchInput("")}
            accessibilityLabel={t("wakeups.overview.search_clear")}
          />
        ) : null}
        <Button
          variant="outline"
          size="sm"
          className={cn("min-h-12", filterCount > 0 && "bg-accent border-accent")}
          onPress={() => setSheetOpen(true)}
          testID="wakeups-filter-button"
        >
          <Text>
            {filterCount > 0
              ? t("wakeups.overview.filter_count", { count: filterCount })
              : t("wakeups.overview.filter")}
          </Text>
        </Button>
      </View>
    </View>
  );

  let body: React.ReactNode;
  const state = listState(list);
  if (state === "loading") {
    body = <OverviewLoading label={t("wakeups.overview.loading")} />;
  } else if (state === "offline") {
    body = <ListOffline onRetry={() => list.refetch()} testID="wakeups-overview-offline" />;
  } else if (state === "error") {
    body = (
      <View className="px-4 gap-3 pt-4" testID="wakeups-overview-error">
        <Text className="text-sm text-destructive">{t("wakeups.overview.load_failed")}</Text>
        <Button variant="outline" onPress={() => list.refetch()}>
          <Text>{t("common:actions.retry")}</Text>
        </Button>
      </View>
    );
  }

  const selectionBar = selecting ? (
    <View
      className="flex-row flex-wrap items-center gap-2 border-b border-border bg-secondary px-4 py-2"
      testID="wakeups-bulk-bar"
    >
      <Text
        className="flex-1 min-w-[120px] text-sm font-medium text-foreground"
        accessibilityLiveRegion="polite"
        testID="wakeups-bulk-count"
      >
        {t("wakeups.bulk.selected", { count: selected.size })}
      </Text>
      <Button
        variant="destructive"
        size="sm"
        className="min-h-12"
        disabled={bulk.isPending}
        onPress={confirmBulk}
        testID="wakeups-bulk-disable"
      >
        <Text>{bulk.isPending ? t("wakeups.bulk.disabling") : t("wakeups.bulk.disable")}</Text>
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="min-h-12"
        disabled={bulk.isPending}
        onPress={cancelSelection}
        testID="wakeups-bulk-cancel"
      >
        <Text>{t("common:actions.cancel")}</Text>
      </Button>
    </View>
  ) : null;

  return (
    <View className="flex-1" testID="wakeups-overview">
      {selectionBar}
      {body ? (
        <>
          {header}
          {body}
        </>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={overviewRowKey}
          ListHeaderComponent={header}
          contentContainerClassName="pb-6 grow"
          ItemSeparatorComponent={() => <View className="h-px bg-border ml-4" />}
          ListEmptyComponent={
            overviewEmptyKind(filters, counts) === "none" ? (
              <View
                className="items-center px-8 py-12 gap-3"
                accessible
                testID="wakeups-overview-empty"
              >
                <Text className="text-base font-medium text-foreground text-center">
                  {t("wakeups.overview.empty_title")}
                </Text>
                <Text className="text-sm text-muted-foreground text-center">
                  {t("wakeups.overview.empty_body")}
                </Text>
              </View>
            ) : (
              <View className="items-center px-8 py-12 gap-3" testID="wakeups-overview-no-matches">
                <Text className="text-sm text-muted-foreground text-center">
                  {t("wakeups.overview.no_matches")}
                </Text>
                <Button variant="outline" onPress={reset} testID="wakeups-overview-reset">
                  <Text>{t("wakeups.overview.filter_reset")}</Text>
                </Button>
              </View>
            )
          }
          ListFooterComponent={
            rows.length > 0 ? (
              <View className="items-center gap-2 py-3" testID="wakeups-overview-footer">
                {list.isFetchingNextPage ? <ActivityIndicator /> : null}
                {list.isFetchNextPageError ? (
                  <Button variant="outline" size="sm" onPress={() => list.fetchNextPage()}>
                    <Text>{t("wakeups.overview.load_more_failed")}</Text>
                  </Button>
                ) : null}
                <Text className="text-xs text-muted-foreground">
                  {t("wakeups.overview.footer", { shown: rows.length, total: Math.max(total, rows.length) })}
                </Text>
              </View>
            ) : null
          }
          onEndReachedThreshold={0.5}
          onEndReached={() => {
            if (list.hasNextPage && !list.isFetchingNextPage && !list.isFetchNextPageError) {
              void list.fetchNextPage();
            }
          }}
          renderItem={({ item }) => (
            <OverviewRow
              wakeup={item}
              names={names}
              forbidden={forbidden.has(item.id)}
              onForbidden={onForbidden}
              selecting={selecting}
              selected={selected.has(item.id)}
              busy={bulk.isPending}
              onToggleSelect={toggleSelected}
            />
          )}
          refreshing={list.isRefetching && !list.isFetchingNextPage}
          onRefresh={() => guardedRefresh(() => Promise.all([list.refetch(), paused.refetch()]))}
        />
      )}
      <FilterSheet
        visible={sheetOpen}
        filters={filters}
        agents={agents}
        onChange={(patch) => setFilters((f) => ({ ...f, ...patch }))}
        onReset={() => setFilters((f) => ({ ...f, kind: "all", source: "", agentId: "" }))}
        onClose={() => setSheetOpen(false)}
      />
    </View>
  );
}

const EMPTY_SELECTION: ReadonlySet<string> = new Set();

function OverviewRow({
  wakeup: w,
  names,
  forbidden,
  onForbidden,
  selecting,
  selected,
  busy,
  onToggleSelect,
}: {
  wakeup: MobileWorkspaceWakeup;
  names: WakeupNames;
  forbidden: boolean;
  onForbidden: (id: string) => void;
  selecting: boolean;
  selected: boolean;
  busy: boolean;
  onToggleSelect: (w: MobileWorkspaceWakeup) => void;
}) {
  const { t } = useT("issues");
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  const wsSlug = useWorkspaceStore((s) => s.currentWorkspaceSlug);
  const menu = useWakeupMenu({ issueId: w.issue_id, onForbidden });
  const system = isSystemRow(w);
  const actions = overviewRowActions(w, forbidden);
  const switchState = overviewSwitchState(w, forbidden);
  const switchOn = menu.togglingTo ?? switchState === "on";
  const deleting = menu.deletingId === w.id;
  const agent = w.agent_name || t("wakeups.agent_subject");

  const issue = [w.issue_identifier, w.issue_title].filter(Boolean).join(" · ");
  const trigger = system
    ? i18n.exists(`issues:wakeups.overview.system_rule.${w.rule}`)
      ? t(`wakeups.overview.system_rule.${w.rule}`)
      : String(w.rule ?? "")
    : wakeupTriggerText(w, names);
  const stateText = w.paused_reason
    ? t("wakeups.state_paused")
    : t(w.enabled ? "wakeups.state_on" : "wakeups.state_off");
  const meta = [
    system ? null : wakeupSourceText(w),
    system && w.system_stage != null ? t("wakeups.overview.system_stage", { stage: w.system_stage }) : null,
    system && w.system_remaining != null
      ? t("wakeups.overview.system_remaining", { count: w.system_remaining })
      : null,
    w.active_runs > 0 ? t("wakeups.overview.active_runs", { count: w.active_runs }) : null,
    t("wakeups.overview.runs_7d", { count: w.runs_7d }),
  ]
    .filter(Boolean)
    .join(" · ");
  const paused = wakeupPausedText(w);

  const label = [
    issue,
    w.issue_closed ? t("wakeups.overview.issue_closed") : null,
    system ? t("wakeups.overview.system_chip") : null,
    `${trigger}, ${t("wakeups.wakes", { agent })}`,
    stateText,
    meta,
    paused,
    actions.length === 0 && !system ? t("wakeups.overview.no_actions") : null,
  ]
    .filter(Boolean)
    .join(", ");

  const openIssue = () => {
    if (wsSlug) router.push(wakeupIssueHref(wsSlug, w.issue_id));
  };

  // In selection mode a tap (de)selects; long-press starts it.
  const selectable = isBulkSelectable(w, forbidden);
  const canToggle = !busy && (selected || selectable);
  const onPress = selecting ? (canToggle ? () => onToggleSelect(w) : undefined) : openIssue;
  const onLongPress = canToggle
    ? () => onToggleSelect(w)
    : !selecting && actions.length > 0
      ? () => menu.open(w, actions)
      : undefined;
  const a11yActions = [
    ...(canToggle
      ? [{ name: selected ? "deselect" : "select", label: t(selected ? "wakeups.bulk.deselect" : "wakeups.bulk.select") }]
      : []),
    ...menu.accessibilityActionsFor(actions),
  ];

  return (
    <View
      className={cn("flex-row items-start gap-1 pl-4 pr-3 py-2", deleting && "opacity-60")}
      testID={`wakeups-overview-row-${w.id}`}
    >
      {selecting ? (
        <View
          className="min-h-12 w-8 items-center justify-center"
          importantForAccessibility="no-hide-descendants"
          testID={selected ? "wakeups-bulk-checked" : "wakeups-bulk-unchecked"}
        >
          <Ionicons
            name={selected ? "checkbox" : "square-outline"}
            size={22}
            color={selected || selectable ? theme.foreground : theme.mutedForeground}
          />
        </View>
      ) : null}
      <Pressable
        onPress={onPress}
        onLongPress={onLongPress}
        accessible
        accessibilityRole={selecting ? "checkbox" : "button"}
        accessibilityLabel={label}
        accessibilityHint={
          selecting
            ? selectable || selected
              ? undefined
              : t("wakeups.bulk.not_selectable")
            : t("wakeups.overview.open_issue_a11y", { issue: w.issue_identifier || issue })
        }
        accessibilityState={selecting ? { busy: deleting, checked: selected, disabled: !canToggle } : { busy: deleting }}
        accessibilityActions={a11yActions}
        onAccessibilityAction={(e) => {
          const name = e.nativeEvent.actionName;
          if (name === "select" || name === "deselect") {
            if (canToggle) onToggleSelect(w);
            return;
          }
          const action = actions.find((a) => a === name);
          if (action) menu.run(w, action);
        }}
        className="flex-1 gap-1 py-1 min-h-12 active:bg-secondary"
        testID="wakeups-overview-row"
      >
        <View className="flex-row flex-wrap items-center gap-x-2 gap-y-1">
          <Text className="text-sm font-medium text-foreground shrink">{issue}</Text>
          {w.issue_closed ? (
            <Text className="text-xs text-muted-foreground rounded bg-secondary px-1.5 py-0.5">
              {t("wakeups.overview.issue_closed")}
            </Text>
          ) : null}
          {system ? (
            <Text className="text-xs text-foreground rounded bg-secondary px-1.5 py-0.5">
              {t("wakeups.overview.system_chip")}
            </Text>
          ) : null}
        </View>
        <View className="flex-row items-start gap-2">
          <Ionicons
            name={WAKEUP_ICON_NAME[system ? "event" : wakeupIcon(w)]}
            size={14}
            color={theme.foreground}
            style={{ marginTop: 2 }}
          />
          <Text className="flex-1 text-sm text-foreground">
            {trigger} · {t("wakeups.wakes", { agent })}
          </Text>
          {switchState === "hidden" ? (
            <Text className="text-xs text-muted-foreground">{stateText}</Text>
          ) : null}
        </View>
        {meta ? <Text className="text-xs text-muted-foreground">{meta}</Text> : null}
        {paused ? <Text className="text-xs text-warning">{paused}</Text> : null}
        {w.last_error ? (
          <Text className="text-xs text-destructive" numberOfLines={3}>
            {w.last_error}
          </Text>
        ) : null}
      </Pressable>
      {switchState !== "hidden" ? (
        <View className="min-h-[48px] min-w-[48px] items-center justify-center">
          <Switch
            checked={switchOn}
            disabled={switchState === "off_locked" || menu.pending || busy}
            onCheckedChange={(on) => menu.run(w, on ? "enable" : "disable")}
            accessibilityLabel={t("wakeups.toggle_a11y", { agent })}
            hitSlop={14}
            testID={`wakeups-overview-switch-${w.id}`}
          />
        </View>
      ) : null}
      {actions.length > 0 ? (
        <IconButton
          name="ellipsis-horizontal"
          iconSize={18}
          onPress={() => menu.open(w, actions)}
          accessibilityLabel={t("wakeups.menu_a11y", { agent })}
          testID={`wakeups-overview-menu-${w.id}`}
        />
      ) : null}
    </View>
  );
}

function FilterSheet({
  visible,
  filters,
  agents,
  onChange,
  onReset,
  onClose,
}: {
  visible: boolean;
  filters: OverviewFilterState;
  agents: { id: string; name: string }[];
  onChange: (patch: Partial<OverviewFilterState>) => void;
  onReset: () => void;
  onClose: () => void;
}) {
  const { t } = useT("issues");
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable className="flex-1 bg-black/40 justify-end" onPress={onClose}>
        <Pressable onPress={() => {}} className="w-full max-w-[560px] self-center">
          <View className="bg-popover rounded-t-xl max-h-[85vh]" style={continuousCorners} testID="wakeups-filter-sheet">
            <View className="flex-row flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-border">
              <Text className="text-base font-semibold text-foreground" accessibilityRole="header">
                {t("wakeups.overview.filter_title")}
              </Text>
              <View className="flex-row gap-2">
                <Button variant="ghost" size="sm" className="min-h-12" onPress={onReset} testID="wakeups-filter-reset">
                  <Text>{t("wakeups.overview.filter_reset")}</Text>
                </Button>
                <Button size="sm" className="min-h-12" onPress={onClose} testID="wakeups-filter-done">
                  <Text>{t("wakeups.overview.filter_done")}</Text>
                </Button>
              </View>
            </View>
            <ScrollView contentContainerClassName="pb-6">
              <OptionGroup
                title={t("wakeups.overview.kind_label")}
                options={OVERVIEW_KINDS.map((k) => ({ value: k, label: t(`wakeups.overview.kind.${k}`) }))}
                value={filters.kind}
                onPick={(kind) => onChange({ kind })}
                testID="wakeups-filter-kind"
              />
              <OptionGroup
                title={t("wakeups.overview.source_label")}
                options={OVERVIEW_SOURCES.map((s) => ({
                  value: s,
                  label: t(`wakeups.overview.source.${s || "all"}`),
                }))}
                value={filters.source}
                onPick={(source) => onChange({ source })}
                testID="wakeups-filter-source"
              />
              <OptionGroup
                title={t("wakeups.overview.agent_label")}
                options={[
                  { value: "", label: t("wakeups.overview.any_agent") },
                  ...agents.map((a) => ({ value: a.id, label: a.name || a.id })),
                ]}
                value={filters.agentId}
                onPick={(agentId) => onChange({ agentId })}
                testID="wakeups-filter-agent"
              />
            </ScrollView>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function OptionGroup<V extends string>({
  title,
  options,
  value,
  onPick,
  testID,
}: {
  title: string;
  options: { value: V; label: string }[];
  value: V;
  onPick: (value: V) => void;
  testID: string;
}) {
  const { colorScheme } = useColorScheme();
  return (
    <View className="pt-3" accessibilityRole="radiogroup" accessibilityLabel={title} testID={testID}>
      <Text className="px-4 pb-1 text-xs uppercase tracking-wider text-muted-foreground font-medium">
        {title}
      </Text>
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <Pressable
            key={o.value || "all"}
            onPress={() => onPick(o.value)}
            accessibilityRole="radio"
            accessibilityState={{ checked: selected }}
            className="flex-row items-center gap-3 px-4 py-2 min-h-12 active:bg-secondary"
            testID={`${testID}-${o.value || "all"}`}
          >
            <Ionicons
              name={selected ? "radio-button-on" : "radio-button-off"}
              size={20}
              color={THEME[colorScheme].foreground}
            />
            <Text className="flex-1 text-sm text-foreground">{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function OverviewLoading({ label }: { label: string }) {
  return (
    <View
      className="px-4 pt-4 gap-5"
      accessible
      accessibilityLabel={label}
      accessibilityLiveRegion="polite"
      testID="wakeups-overview-loading"
    >
      {Array.from({ length: 4 }).map((_, i) => (
        <View key={i} className="gap-2">
          <Skeleton className="h-3.5 w-1/2" />
          <Skeleton className="h-3 w-3/4" />
          <Skeleton className="h-3 w-2/3" />
        </View>
      ))}
    </View>
  );
}
