import { memo, useEffect, useMemo, useState } from "react";
import { Alert, FlatList, View } from "react-native";
import { showActionSheet } from "@/lib/action-sheet";
import { useQuery } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@/components/ui/ionicons";
import type { InboxItem } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Header } from "@/components/ui/header";
import { IconButton } from "@/components/ui/icon-button";
import { HeaderActions } from "@/components/ui/app-header-actions";
import { SegmentedPills } from "@/components/ui/segmented-pills";
import { SwipeableInboxRow } from "@/components/inbox/swipeable-inbox-row";
import { PushPermissionCard } from "@/components/inbox/push-permission-card";
import {
  inboxArchivedOptions,
  inboxKeys,
  inboxListOptions,
} from "@/data/queries/inbox";
import {
  useArchiveAllInbox,
  useArchiveAllReadInbox,
  useArchiveCompletedInbox,
  useArchiveInbox,
  useMarkAllInboxRead,
  useMarkInboxRead,
  useMarkInboxUnread,
  useUnarchiveInbox,
} from "@/data/mutations/inbox";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { useT } from "@/lib/i18n";
import {
  deduplicateInboxItems,
  filterInboxView,
  getInboxOpenTarget,
  type InboxView,
} from "@/lib/inbox-display";
import { guardedRefresh } from "@/lib/refresh-guard";
import { inboxViewFromParam } from "@/lib/inbox-view-param";
import { useMarkInboxIssueDone } from "@/data/mutations/issue-chat";
import { canMarkDone } from "@/lib/issue-chat";
import { markInAppChatOpen } from "@/lib/chat-open-intent";
import {
  useInboxFilters,
  useInboxFilterStore,
} from "@/data/stores/inbox-filter-store";
import {
  effectiveInboxFilters,
  filterInboxItems,
  inboxFilterCount,
  inboxSupportsPriority,
} from "@/lib/inbox-filters";
import { useRefreshOnFocus } from "@/lib/use-refresh-on-focus";
import { perfMark } from "@/lib/perf-mark";
import { READING_WIDTH_STYLE, ReadingWidth } from "@/components/ui/reading-width";

const VIEWS: InboxView[] = ["all", "unread", "archived"];

/**
 * Inbox tab.
 *
 * Web parity (packages/views/inbox/components/inbox-page.tsx): the list is
 * deduplicated per issue, has an "unread only" filter and an "Archived"
 * sub-view, batch actions in the header menu, and per-row actions
 * (mark read/unread, archive/restore, open). On the phone the filter and
 * the archived view are one segmented row above the list; per-row actions
 * live on long-press (plus the existing swipe-to-archive).
 *
 * Status / priority / "From" filters apply to the active
 * views (All, Unread), client-side because `GET /api/inbox` has no filter
 * params — same as web. They are remembered per workspace
 * (`useInboxFilterStore`). The unread badge stays the unfiltered count.
 *
 * Memoized: pushing an issue chat re-renders the layout chain
 * above (expo-router passes no changing props), and the tab must not
 * re-render with it.
 */
export default memo(function Inbox() {
  perfMark("render:inbox");
  const { t } = useT("inbox");
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const wsSlug = useWorkspaceStore((s) => s.currentWorkspaceSlug);
  const { colorScheme } = useColorScheme();
  // `?view=unread` from the summary notification picks the segment,
  // also when the Inbox was already open (warm start).
  const { view: viewParam } = useLocalSearchParams<{ view?: string }>();
  const [view, setView] = useState<InboxView>(() => inboxViewFromParam(viewParam) ?? "all");
  useEffect(() => {
    const fromLink = inboxViewFromParam(viewParam);
    if (fromLink) setView(fromLink);
  }, [viewParam]);
  const showArchived = view === "archived";

  const live = useQuery(inboxListOptions(wsId));
  const archived = useQuery(inboxArchivedOptions(wsId, showArchived));
  useRefreshOnFocus([inboxKeys.all(wsId)]);
  const source = showArchived ? archived : live;

  // Dedup + drop archived to match web/desktop. See CLAUDE.md
  // "Behavioral parity" → inbox dedup incident. The archived view keeps its
  // rows as served (they are archived by definition).
  const storedFilters = useInboxFilters(wsId);
  useEffect(() => {
    if (wsId) void useInboxFilterStore.getState().hydrate(wsId);
  }, [wsId]);
  const filters = useMemo(
    () => effectiveInboxFilters(storedFilters, inboxSupportsPriority(live.data ?? [])),
    [storedFilters, live.data],
  );
  const activeFilterCount = showArchived ? 0 : inboxFilterCount(filters);

  const data = useMemo(() => {
    if (showArchived) return archived.data ?? [];
    return filterInboxItems(
      filterInboxView(deduplicateInboxItems(live.data ?? []), view),
      filters,
    );
  }, [showArchived, archived.data, live.data, view, filters]);

  const openFilter = () => {
    if (!wsSlug) return;
    router.push({
      pathname: "/[workspace]/inbox-filter",
      params: { workspace: wsSlug, view },
    });
  };

  const markRead = useMarkInboxRead();
  const markUnread = useMarkInboxUnread();
  const markAllRead = useMarkAllInboxRead();
  const archive = useArchiveInbox();
  const unarchive = useUnarchiveInbox();
  const archiveAll = useArchiveAllInbox();
  const archiveAllRead = useArchiveAllReadInbox();
  const archiveCompleted = useArchiveCompletedInbox();

  const markDone = useMarkInboxIssueDone();

  // Tap opens by type: conversation and action
  // types → issue chat, the rest → detail. The long-press menu offers both.
  const openItem = (item: InboxItem, mode: "auto" | "chat" | "detail" = "auto") => {
    const target = getInboxOpenTarget(item, wsSlug, String(Date.now()), mode);
    if (!target) return;
    if (target.pathname === "/[workspace]/issue/[id]/chat") markInAppChatOpen(target.params.id);
    router.push(target);
  };

  const onPressItem = (item: InboxItem) => {
    if (!item.read && !showArchived) {
      // Optimistic read flip lives in useMarkInboxRead.onMutate — fires
      // setQueryData synchronously before the cancelQueries await, so the
      // row is already styled "read" by the time iOS captures the source
      // snapshot for the native stack push transition.
      markRead.mutate(item.id);
    }
    openItem(item);
  };

  // Per-row menu — mirrors web's row actions
  // (packages/views/inbox/components/inbox-row-menu.tsx).
  const onLongPressItem = (item: InboxItem) => {
    const actions: { key: string; label: string; run: () => void }[] = [];
    if (item.issue_id) {
      actions.push({ key: "chat", label: t("actions.open_chat"), run: () => openItem(item, "chat") });
      actions.push({ key: "detail", label: t("actions.open_details"), run: () => openItem(item, "detail") });
    } else if (item.type === "autopilot_quota_exceeded" || item.type === "autopilot_paused") {
      actions.push({ key: "open", label: t("actions.open_issue"), run: () => openItem(item) });
    }
    if (!showArchived) {
      actions.push(
        item.read
          ? { key: "unread", label: t("actions.mark_unread"), run: () => markUnread.mutate(item.id) }
          : { key: "read", label: t("actions.mark_read"), run: () => markRead.mutate(item.id) },
      );
      const issueId = item.issue_id;
      if (issueId && canMarkDone(item.issue_status, 1)) {
        actions.push({
          key: "done",
          label: t("actions.done"),
          run: () => markDone.mutate({ issueId, inboxId: item.id }),
        });
      }
      actions.push({ key: "archive", label: t("actions.archive"), run: () => archive.mutate(item.id) });
    } else {
      actions.push({ key: "restore", label: t("actions.unarchive"), run: () => unarchive.mutate(item.id) });
    }
    const options = [t("common:actions.cancel"), ...actions.map((a) => a.label)];
    const destructiveIndex = actions.findIndex((a) => a.key === "archive");
    showActionSheet(
      {
        options,
        cancelButtonIndex: 0,
        destructiveButtonIndex: destructiveIndex >= 0 ? destructiveIndex + 1 : undefined,
        title: item.title,
      },
      (i) => {
        if (i > 0) actions[i - 1]?.run();
      },
    );
  };

  // Trailing batch menu — mirrors web's dropdown
  // (packages/views/inbox/components/inbox-page.tsx). "Mark all read" is
  // first (most common batch op); "Archive all" is destructive so it gets
  // the iOS red treatment + Alert confirm.
  const onPressMenu = () => {
    const options = [
      t("common:actions.cancel"),
      t("actions.mark_all_read"),
      t("actions.archive_all_read"),
      t("actions.archive_completed"),
      t("actions.archive_all"),
    ];
    showActionSheet(
      {
        options,
        cancelButtonIndex: 0,
        destructiveButtonIndex: 4,
        title: t("title"),
      },
      (i) => {
        if (i === 1) markAllRead.mutate();
        else if (i === 2) archiveAllRead.mutate();
        else if (i === 3) archiveCompleted.mutate();
        else if (i === 4) {
          Alert.alert(
            t("archive.confirm_title"),
            t("archive.confirm_body"),
            [
              { text: t("common:actions.cancel"), style: "cancel" },
              {
                text: t("actions.archive_all"),
                style: "destructive",
                onPress: () => archiveAll.mutate(),
              },
            ],
          );
        }
      },
    );
  };

  const unreadCount = useMemo(
    () => deduplicateInboxItems(live.data ?? []).filter((i) => !i.read).length,
    [live.data],
  );
  const segments = VIEWS.map((v) => ({
    value: v,
    label: t(`filters.${v}`),
    badge: v === "unread" && unreadCount > 0 ? unreadCount : undefined,
  }));

  return (
    <View className="flex-1 bg-background">
      <Header
        title={t("title")}
        right={
          <>
            <IconButton
              name="ellipsis-horizontal"
              onPress={onPressMenu}
              accessibilityLabel={t("actions.inbox_actions")}
            />
            <HeaderActions />
          </>
        }
      />
      <ReadingWidth>
        <SegmentedPills
          items={segments}
          value={view}
          onChange={setView}
          trailing={
            showArchived ? null : (
              <InboxFilterButton count={activeFilterCount} onPress={openFilter} />
            )
          }
        />
        {/* One-time push opt-in. */}
        {!showArchived ? <PushPermissionCard /> : null}
      </ReadingWidth>
      {source.isLoading ? (
        <InboxLoading />
      ) : source.error ? (
        <View className="px-4 gap-3 pt-4">
          <Text className="text-sm text-destructive">
            {t("errors.load_failed", {
              message: source.error instanceof Error ? source.error.message : "unknown",
            })}
          </Text>
          <Button variant="outline" onPress={() => source.refetch()}>
            <Text>{t("common:actions.retry")}</Text>
          </Button>
        </View>
      ) : data.length === 0 && activeFilterCount > 0 ? (
        <InboxFilteredEmpty
          onClear={() => wsId && useInboxFilterStore.getState().clear(wsId)}
          iconColor={THEME[colorScheme].mutedForeground}
        />
      ) : data.length === 0 ? (
        <InboxEmpty view={view} iconColor={THEME[colorScheme].mutedForeground} />
      ) : (
        <FlatList
          data={data}
          keyExtractor={(item) => item.id}
          ItemSeparatorComponent={() => (
            <View className="h-px bg-border ml-16" />
          )}
          contentContainerClassName="pb-6"
          contentContainerStyle={READING_WIDTH_STYLE}
          renderItem={({ item }) => (
            <SwipeableInboxRow
              item={item}
              mode={showArchived ? "restore" : "archive"}
              onPress={() => onPressItem(item)}
              onLongPress={() => onLongPressItem(item)}
              onArchive={() =>
                showArchived ? unarchive.mutate(item.id) : archive.mutate(item.id)
              }
            />
          )}
          refreshing={source.isRefetching}
          onRefresh={() => guardedRefresh(() => source.refetch())}
        />
      )}
    </View>
  );
});

// Loading state — 6 row-shaped Skeletons matching InboxRow's layout
// (avatar circle + two text lines). Perceived perf wins over a centered
// spinner because the eye immediately sees the list-like structure.
function InboxLoading() {
  return (
    <View className="px-4 pt-4 gap-4">
      {Array.from({ length: 6 }).map((_, i) => (
        <View key={i} className="flex-row gap-3">
          <Skeleton className="size-9 rounded-full" />
          <View className="flex-1 gap-2 pt-1">
            <Skeleton className="h-3.5 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
          </View>
        </View>
      ))}
    </View>
  );
}

function InboxEmpty({ view, iconColor }: { view: InboxView; iconColor: string }) {
  const { t } = useT("inbox");
  const prefix = view === "all" ? "" : `${view}_`;
  return (
    <View className="flex-1 items-center justify-center px-8 gap-3">
      <Ionicons
        name={view === "archived" ? "archive-outline" : "mail-open-outline"}
        size={42}
        color={iconColor}
      />
      <Text className="text-base font-medium text-foreground text-center">
        {t(`empty.${prefix}title`)}
      </Text>
      <Text className="text-sm text-muted-foreground text-center">
        {t(`empty.${prefix}body`)}
      </Text>
    </View>
  );
}

// Filter trigger next to the segments, same shape as the issue-list
// FilterButton (my-issues.tsx), plus the active count so the state is
// visible and announced without opening the sheet.
function InboxFilterButton({
  count,
  onPress,
}: {
  count: number;
  onPress: () => void;
}) {
  const { t } = useT("inbox");
  const { colorScheme } = useColorScheme();
  const label =
    count > 0
      ? t("filter_sheet.button_active", { count })
      : t("filter_sheet.button");
  return (
    <Button
      variant={count > 0 ? "secondary" : "outline"}
      size="sm"
      onPress={onPress}
      accessibilityLabel={label}
      // 44 dp + 2 dp hit-slop = 48 dp touch target.
      className={count > 0 ? "h-11 min-w-11 px-2.5 gap-1" : "h-11 w-11 px-0"}
      hitSlop={2}
    >
      <Ionicons
        name="options-outline"
        size={16}
        color={
          count > 0
            ? THEME[colorScheme].foreground
            : THEME[colorScheme].mutedForeground
        }
      />
      {count > 0 ? (
        <Text className="text-xs font-semibold tabular-nums">{count}</Text>
      ) : null}
    </Button>
  );
}

function InboxFilteredEmpty({
  onClear,
  iconColor,
}: {
  onClear: () => void;
  iconColor: string;
}) {
  const { t } = useT("inbox");
  return (
    <View className="flex-1 items-center justify-center px-8 gap-3">
      <Ionicons name="options-outline" size={42} color={iconColor} />
      <Text className="text-base font-medium text-foreground text-center">
        {t("filter_sheet.empty_title")}
      </Text>
      <Button variant="outline" onPress={onClear}>
        <Text>{t("filter_sheet.clear")}</Text>
      </Button>
    </View>
  );
}
