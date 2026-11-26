/**
 * The scrolling timeline. ASC chronological — oldest at top, newest near the
 * bottom (above the composer). Pull-to-refresh refetches issue + timeline.
 *
 * Backend returns the full timeline in one shot (server-side pagination
 * was dropped in #2322 — p99 ~30 entries per issue, cursor walking only
 * created bugs at reply-thread boundaries). The previous "Pull to load
 * older" UX and top-edge `fetchOlder` trigger are gone.
 *
 * Inbox deep-link — FlashList v2 `initialScrollIndex`:
 *   When `highlightCommentId` is set, the list lands on the row of that
 *   comment (a reply lands on its root's row, see `findLandingIndex`) with
 *   the comment's start at the top of the viewport. Web centers the target
 *   instead (`packages/views/issues/components/issue-detail.tsx`, landing
 *   effect); on a phone a comment is often taller than half the screen, so
 *   centering would cut off its beginning. Without a target, or when the
 *   comment is not in the timeline (deleted, notification without
 *   comment), the list opens at the issue header like a normal issue-open.
 *
 *   We pass the index as `initialScrollIndex` and remount the list via
 *   `key={`hl-${highlightNonce}`}` once timeline data has arrived.
 *   FlashList then lays out from that row and scrolls to it before the
 *   first paint; after that MVCP keeps the visible content stable while
 *   the rows above get measured and async resizes land (Shiki highlight,
 *   image natural-size, WS `comment:updated`). No JS-side scroll dance.
 *
 *   Earlier the deep-link used `startRenderingFromBottom`, i.e.
 *   it always landed at the END of the thread and the user had to scroll
 *   up to the target and to title/status/description — on long threads
 * that was a long way. An older hand-rolled `landed` state
 *   gate that re-fired `scrollToEnd` on every `onContentSizeChange`
 *   deadlocked the user at the bottom (state-vs-event race); that is why
 *   the landing must stay a one-shot inside FlashList.
 *
 *   The matching <CommentCard>'s `RootHighlightOverlay` fires when the
 *   target row enters the render window — with the landing above that is
 *   right on arrival. `HIGHLIGHT_HOLD_MS` (5s) is the window for that.
 *
 *   Why not `scrollToIndex` after mount: it requires accurate height
 *   estimates that variable-height markdown bubbles can't provide, even
 *   with `onScrollToIndexFailed` retry (web hit the same wall and splits
 *   into virtualized-for-browse / flat-for-deep-link). `initialScrollIndex`
 *   does not need estimates for the rows above: it starts rendering AT the
 *   target and lets MVCP absorb the corrections.
 *
 * `maintainVisibleContentPosition` is enabled by default on FlashList v2
 * and is implemented inside the C++ shadow tree — it compensates the
 * scroll offset both when a row is INSERTED above the viewport AND when
 * an upper row RESIZES (a WS `comment:updated` / `reaction:added` /
 * `resolved` event on an older comment used to push the user's read
 * position down by the delta). On FlatList the same prop was iOS-only
 * + JS-side; the FlashList path is steadier and animates the offset
 * compensation rather than snapping it.
 *
 * List engine: FlashList v2 (Shopify). Migrated from FlatList because:
 *   1. Cell recycling — markdown bubbles (Shiki highlight, image natural-
 *      size, lightbox provider injection) are expensive to mount; FlashList
 *      keeps them in recycled cells when scrolling through history rather
 *      than re-running the multi-pass render each time a row re-enters the
 *      window.
 *   2. Native MVCP — see paragraph above. Smoother behavior than FlatList's
 *      JS-side implementation when WS events resize an upper row.
 *   3. Async-render stability — async markdown size changes inside the
 *      viewport no longer cause the visual "twitch" we saw with FlatList,
 *      because FlashList re-layouts inside the shadow tree without
 *      surfacing a JS-side onContentSizeChange storm.
 *
 * What FlashList v2 does NOT change about this file:
 *   - `startRenderingFromBottom` is NOT enabled: a normal issue-open
 *     shows the header (title, description, status) first, an Inbox
 *     deep-link lands on its comment (see above), neither jumps straight
 *     to the latest reply.
 *   - Spacing between rows. FlashList ignores `gap-*` on
 *     `contentContainer` the same way it does in chat-message-list.tsx —
 *     we use `ItemSeparatorComponent` for the 12 px breathing room and
 *     `ListHeaderComponentStyle` to add the same gap below the header.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ViewToken,
} from "react-native";
import { FlashList, type FlashListRef } from "@shopify/flash-list";
import { Ionicons } from "@/components/ui/ionicons";
import { useQuery } from "@tanstack/react-query";
import type { Issue, TimelineEntry } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { IssueHeaderCard } from "./issue-header-card";
import { IssueDescription } from "./issue-description";
import { IssueReactionRow } from "./issue-reaction-row";
import { SubIssuesSection } from "./sub-issues-section";
import { WakeupsSection } from "./wakeups-section";
import { ActivityRow } from "./activity-row";
import { CommentCard } from "./comment-card";
import { useLastViewedStore } from "@/data/stores/last-viewed-store";
import { coalesceTimeline } from "@/lib/timeline-coalesce";
import {
  buildTimelineRows,
  findLandingIndex,
  timelineListTestID,
  type TimelineRow,
} from "@/lib/timeline-thread";
import {
  computeJumpVisibility,
  jumpFollowShouldPin,
  JUMP_FOLLOW_MS,
  JUMP_FOLLOW_TICK_MS,
} from "@/lib/timeline-jump";
import { ImageSequenceProvider } from "@/lib/markdown/image-sequence";
import { issueAttachmentsOptions } from "@/data/queries/issues";
import { useWorkspaceStore } from "@/data/workspace-store";
import type { ImageSequenceBlock } from "@multica/core/attachments/image-sequence";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { useT } from "@/lib/i18n";
import { useCommentSelectStore } from "@/data/comment-select-store";

interface Props {
  issue: Issue;
  entries: TimelineEntry[] | undefined;
  timelineLoading: boolean;
  refreshing: boolean;
  onRefresh: () => void;
  /** Inbox deep-link target. Root comment id OR reply id — replies live
   *  inline inside their parent's CommentCard, so a reply target scrolls
   *  to the parent's row and the card highlights the matching child. */
  highlightCommentId?: string;
  /** Per-tap nonce. Re-tapping the same inbox row produces the same
   *  `highlightCommentId` but a fresh nonce, which re-triggers the
   *  scroll-and-flash effect (without this, identical props short-circuit). */
  highlightNonce?: string;
  /** "Open as chat" under the Activity heading. */
  onOpenChat?: () => void;
  /** Two-pane tablet detail: the head lives in the left pane. */
  hideIssueHead?: boolean;
  /** Land on the "Wakeups" section (`?section=wakeups`, from the
   *  workspace wakeup overview, W8). */
  focusWakeups?: boolean;
}

/** How long the flash stays "claimed" before we let a new highlight take
 *  over. The fade-out itself is driven by the Reanimated sequence inside
 *  CommentCard; this is just the upstream gate. The deep-link lands on
 *  the target row, so the overlay normally fires right away; 5s covers a
 *  slow first paint of a long thread. */
const HIGHLIGHT_HOLD_MS = 5000;

/** Pixel slack at the bottom edge — inside this band we treat the user as
 *  "already at bottom" so the new-comment chip doesn't fire for entries
 *  the user is already about to see. */
const AT_BOTTOM_SLACK_PX = 80;

/** The jump-to-latest thresholds and follow-window rules live in
 *  lib/timeline-jump.ts (pure logic, unit-tested). */

/** Sentinel id for the "New since last view" divider row injected into the
 *  FlatList data. Picked because it can never collide with a real comment
 *  / activity uuid. */
const DIVIDER_ID = "__divider__";

export function TimelineList({
  issue,
  entries,
  timelineLoading,
  refreshing,
  onRefresh,
  highlightCommentId,
  highlightNonce,
  onOpenChat,
  hideIssueHead = false,
  focusWakeups = false,
}: Props) {
  // Top-level selection subscription gates the outer "tap-outside-to-dismiss"
  // Pressable below. When null, the Pressable stays disabled and every tap
  // passes through to comment cards / chip rows / reactions normally.
  const { t } = useT("issues");
  const selectingId = useCommentSelectStore((s) => s.selectingId);

  // Server already returns ASC oldest-first. Pipeline:
  //   1. coalesceTimeline → merge consecutive identical activities
  //   2. buildTimelineRows → reorder so replies sit adjacent to their parent
  //      and tag each reply with `replyTo` for the card to render the
  //      "↪ Replying to" header + thread-line border. This is the mobile
  //      flat-list interpretation of web's recursive reply tree.
  const data = useMemo<TimelineRow[]>(() => {
    if (!entries) return [];
    return buildTimelineRows(coalesceTimeline(entries));
  }, [entries]);

  // Every image on this screen, in render order: the description first, then
  // each comment row with its replies (MUL-5752). Tapping any of them opens
  // the lightbox at its real position so a swipe walks to the next.
  //
  // The description's attachments come from the same query IssueDescription
  // uses — TanStack Query dedupes it, so this adds no request.
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const { data: issueAttachments } = useQuery(
    issueAttachmentsOptions(wsId, issue.id),
  );
  const imageBlocks = useMemo<ImageSequenceBlock[]>(() => {
    const blocks: ImageSequenceBlock[] = [
      { content: issue.description, attachments: issueAttachments },
    ];
    for (const row of data) {
      if (row.entry.type !== "comment") continue;
      blocks.push({
        content: row.entry.content,
        attachments: row.entry.attachments,
      });
      for (const reply of row.replies) {
        blocks.push({ content: reply.content, attachments: reply.attachments });
      }
    }
    return blocks;
  }, [issue.description, issueAttachments, data]);

  const listRef = useRef<FlashListRef<TimelineRow>>(null);
  // Header wakeup chip → "Wakeups" section. The section is a
  // direct child of the list header, so its layout y is its list offset.
  const wakeupsY = useRef(0);
  const scrollToWakeups = useCallback(() => {
    listRef.current?.scrollToOffset({ offset: wakeupsY.current, animated: true });
  }, []);
  // `focusWakeups`: follow the section while the header above it
  // still grows (description, sub-issues load late), until the user drags.
  const wakeupsLandingDone = useRef(!focusWakeups);
  // Gates single-shot per (commentId, nonce) tuple. Re-tap from inbox
  // bumps the nonce → ref no longer matches → effect re-fires.
  const lastStampRef = useRef<string | null>(null);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);

  // ── "New since last view" divider ─────────────────────────────────────
  // Snapshot the last-viewed timestamp ONCE on mount. Subsequent WS
  // appends shouldn't shift the divider — the user wants a stable
  // "where I was when I came back" boundary. The store update happens on
  // unmount, gated on the user having actually scrolled past the divider.
  const lastViewedSnapshotRef = useRef<string | null | undefined>(undefined);
  if (lastViewedSnapshotRef.current === undefined) {
    lastViewedSnapshotRef.current =
      useLastViewedStore.getState().getLastViewed(issue.id) ?? null;
  }
  const dividerAnchorId = useMemo(() => {
    const snapshot = lastViewedSnapshotRef.current;
    if (!snapshot) return null;
    // First entry strictly newer than the snapshot anchors the divider;
    // divider draws ABOVE this row. If everything is older, no divider.
    const found = data.find((r) => r.entry.created_at > snapshot);
    return found ? found.entry.id : null;
  }, [data]);
  const dividerScrolledPastRef = useRef(false);

  useEffect(() => {
    if (!highlightCommentId || data.length === 0) return;
    const stamp = `${highlightCommentId}:${highlightNonce ?? ""}`;
    if (lastStampRef.current === stamp) return;
    lastStampRef.current = stamp;

    setHighlightedId(highlightCommentId);

    const fade = setTimeout(() => setHighlightedId(null), HIGHLIGHT_HOLD_MS);
    return () => clearTimeout(fade);
  }, [highlightCommentId, highlightNonce, data.length]);

  // ── New-comment-while-reading chip ────────────────────────────────────
  // After landing, if WS appends new entries while the user is NOT at the
  // bottom, surface a floating "↓ N new" chip instead of silently shifting
  // content below the viewport. Tapping the chip scrolls to bottom and
  // clears the counter; reaching the bottom by hand also clears it.
  const [newCount, setNewCount] = useState(0);
  const isAtBottomRef = useRef(true);
  const lastDataLenRef = useRef(0);
  useEffect(() => {
    const grew = data.length > lastDataLenRef.current;
    const diff = data.length - lastDataLenRef.current;
    lastDataLenRef.current = data.length;
    if (!grew) return;
    // `isAtBottomRef` defaults to `true` so the initial 0→N load is treated
    // as "user is already at the bottom" and the chip stays silent until a
    // later WS append arrives while the user is scrolled up.
    if (isAtBottomRef.current) return;
    setNewCount((prev) => prev + diff);
  }, [data.length]);

  // ── "Jump to latest" button ───────────────────────────────────────────
  // Upstream web parity (MUL-8324/MUL-8951): visible while the newest
  // entry is more than a screen away (hysteresis: RETURN_WITHIN_SCREENS on
  // the way back) AND — phone layouts — the reader is still near the top
  // of the page, where the button covers the text column the least. A
  // jump also re-pins the end while the follow window is open
  // (JUMP_FOLLOW_MS): async markdown and WS appends can resolve after the
  // jump and land the reader short of the bottom.
  const [jumpVisible, setJumpVisible] = useState(false);
  const jumpAwayRef = useRef(false);
  const jumpTailPendingRef = useRef(true);
  const jumpTailIdxRef = useRef(-1);
  const jumpLastIndexRef = useRef(-1);
  const jumpMetricsRef = useRef({
    offset: 0,
    contentH: 0,
    viewportH: 0,
    lastOffsetChangeAt: 0,
  });
  const jumpFollowRef = useRef<{
    until: number;
    timer: ReturnType<typeof setInterval>;
  } | null>(null);

  const stopJumpFollow = useCallback(() => {
    const follow = jumpFollowRef.current;
    if (follow) {
      clearInterval(follow.timer);
      jumpFollowRef.current = null;
    }
  }, []);

  const recomputeJumpVisibility = useCallback(() => {
    const { away, visible } = computeJumpVisibility(
      jumpAwayRef.current,
      jumpMetricsRef.current,
      jumpTailPendingRef.current,
    );
    jumpAwayRef.current = away;
    setJumpVisible((prev) => (prev === visible ? prev : visible));
  }, []);

  const jumpToLatest = useCallback(() => {
    stopJumpFollow();
    listRef.current?.scrollToEnd({ animated: true });
    const until = Date.now() + JUMP_FOLLOW_MS;
    const timer = setInterval(() => {
      const follow = jumpFollowRef.current;
      if (!follow || Date.now() >= until) {
        stopJumpFollow();
        return;
      }
      const { offset, contentH, viewportH, lastOffsetChangeAt } =
        jumpMetricsRef.current;
      // Re-pin only once the travel has settled — pinning mid-flight would
      // fight the animated jump. Late content growth (which moves the
      // bottom without moving the offset) is caught here as well.
      if (jumpFollowShouldPin(
        { offset, contentH, viewportH },
        lastOffsetChangeAt,
        Date.now(),
      )) {
        listRef.current?.scrollToEnd({ animated: false });
      }
    }, JUMP_FOLLOW_TICK_MS);
    jumpFollowRef.current = { until, timer };
  }, [stopJumpFollow]);

  const onJumpToLatest = useCallback(() => {
    jumpToLatest();
    setNewCount(0);
  }, [jumpToLatest]);

  const handleContentSizeChange = useCallback(
    (_width: number, height: number) => {
      jumpMetricsRef.current.contentH = height;
      recomputeJumpVisibility();
    },
    [recomputeJumpVisibility],
  );

  const handleListLayout = useCallback(
    (e: LayoutChangeEvent) => {
      jumpMetricsRef.current.viewportH = e.nativeEvent.layout.height;
      recomputeJumpVisibility();
    },
    [recomputeJumpVisibility],
  );

  const handleScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
      const distFromBottom =
        contentSize.height - (contentOffset.y + layoutMeasurement.height);
      const wasAtBottom = isAtBottomRef.current;
      isAtBottomRef.current = distFromBottom < AT_BOTTOM_SLACK_PX;
      // Reaching the bottom clears the unread-new chip — same iMessage /
      // chat-app semantic: "I've caught up".
      if (!wasAtBottom && isAtBottomRef.current && newCount > 0) {
        setNewCount(0);
      }
      const metrics = jumpMetricsRef.current;
      if (metrics.offset !== contentOffset.y) {
        metrics.lastOffsetChangeAt = Date.now();
      }
      metrics.offset = contentOffset.y;
      metrics.contentH = contentSize.height;
      metrics.viewportH = layoutMeasurement.height;
      recomputeJumpVisibility();
    },
    [newCount, recomputeJumpVisibility],
  );

  // ── Inject divider as a sentinel row before its anchor entry ──────────
  // FlatList wants a flat data[] and a stable key per row. Rather than
  // teach the renderer about "items + dividers" via a union type, fake a
  // TimelineRow with a sentinel id; renderItem checks the id first.
  const dataWithDivider = useMemo<TimelineRow[]>(() => {
    if (!dividerAnchorId) return data;
    const anchorIdx = data.findIndex((r) => r.entry.id === dividerAnchorId);
    if (anchorIdx <= 0) return data;
    const divider: TimelineRow = {
      // Cast: this entry is a synthetic marker, not a real TimelineEntry —
      // renderItem keys off `id === DIVIDER_ID` and never reads other fields.
      entry: {
        id: DIVIDER_ID,
        type: "activity",
        created_at: "",
        actor_type: "",
        actor_id: "",
      } as unknown as TimelineEntry,
      replies: [],
    };
    return [...data.slice(0, anchorIdx), divider, ...data.slice(anchorIdx)];
  }, [data, dividerAnchorId]);

  // Mark "scrolled past" once the divider row leaves the viewport — used
  // by the unmount effect below to decide whether to bump last-viewed.
  const viewabilityConfig = useMemo(
    () => ({ itemVisiblePercentThreshold: 1 }),
    [],
  );
  const handleViewableItemsChanged = useCallback(
    ({ viewableItems }: { viewableItems: ViewToken[] }) => {
      // Tail tracking for "Jump to latest": a virtualized content height
      // can claim the bottom is close while the rows below are still
      // estimated (the web jump calls this `tailPending`). Once the last
      // row has been laid out, the distance to the bottom is exact again.
      if (viewableItems.length > 0) {
        const maxIdx = viewableItems.reduce(
          (acc, v) => (v.index != null && v.index > acc ? v.index : acc),
          jumpTailIdxRef.current,
        );
        if (maxIdx > jumpTailIdxRef.current) {
          jumpTailIdxRef.current = maxIdx;
          if (maxIdx >= jumpLastIndexRef.current) {
            jumpTailPendingRef.current = false;
            recomputeJumpVisibility();
          }
        }
      }
      if (!dividerAnchorId) return;
      if (dividerScrolledPastRef.current) return;
      const dividerIdx = dataWithDivider.findIndex(
        (r) => r.entry.id === DIVIDER_ID,
      );
      if (dividerIdx < 0) return;
      const minVisibleIdx = viewableItems.reduce(
        (acc, v) => (v.index != null && v.index < acc ? v.index : acc),
        Number.POSITIVE_INFINITY,
      );
      if (minVisibleIdx > dividerIdx) {
        dividerScrolledPastRef.current = true;
      }
    },
    [dividerAnchorId, dataWithDivider, recomputeJumpVisibility],
  );
  // FlashList v2 captures `viewabilityConfigCallbackPairs` at mount —
  // "Changing viewabilityConfig on the fly is not supported." So we wrap
  // the handler in a stable ref-backed forwarder and pass a frozen pairs
  // array. The inner closure still updates with deps (dividerAnchorId,
  // dataWithDivider, recomputeJumpVisibility), but the prop identity
  // FlashList sees is stable.
  const handlerRef = useRef(handleViewableItemsChanged);
  useEffect(() => {
    handlerRef.current = handleViewableItemsChanged;
  }, [handleViewableItemsChanged]);
  const stableViewabilityHandler = useCallback(
    (info: { viewableItems: ViewToken[] }) => handlerRef.current(info),
    [],
  );
  const viewabilityCallbackPairs = useRef([
    {
      viewabilityConfig,
      onViewableItemsChanged: stableViewabilityHandler,
    },
  ]);

  // On unmount, mark the issue's timeline as "viewed up to now" if the
  // user has either (a) scrolled past the divider or (b) had no divider
  // because everything was already older than their previous visit.
  // Otherwise leave the snapshot alone so a next visit preserves the
  // "where I was" line.
  const markViewed = useLastViewedStore((s) => s.markViewed);
  useEffect(() => {
    const issueId = issue.id;
    return () => {
      if (!dividerAnchorId || dividerScrolledPastRef.current) {
        markViewed(issueId);
      }
    };
    // We intentionally bind the cleanup to the issueId-snapshot only —
    // re-running on `dividerAnchorId` changes would lose the original
    // anchor's "scrolled past" state if WS extended the timeline mid-read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [issue.id]);

  // Reset the jump state per issue (screens are reused across issues).
  // The tail index and metrics resync from data/layout once the new issue
  // loads, so only the derived bits are cleared here.
  useEffect(() => {
    jumpAwayRef.current = false;
    jumpTailPendingRef.current = true;
    jumpTailIdxRef.current = -1;
    jumpMetricsRef.current = {
      offset: 0,
      contentH: 0,
      viewportH: 0,
      lastOffsetChangeAt: 0,
    };
    setJumpVisible(false);
    return stopJumpFollow;
  }, [issue.id, stopJumpFollow]);

  // Tail-tracking sync for "Jump to latest": the pending flag stays on
  // until the last row has been laid out, then flips off so the scroll
  // position becomes authoritative again.
  useEffect(() => {
    const last = dataWithDivider.length - 1;
    if (last === jumpLastIndexRef.current) return;
    jumpLastIndexRef.current = last;
    if (jumpTailIdxRef.current >= last) {
      jumpTailPendingRef.current = false;
    } else {
      jumpTailPendingRef.current = true;
    }
    recomputeJumpVisibility();
  }, [dataWithDivider, recomputeJumpVisibility]);

  const ListHeader = (
    <View>
      {hideIssueHead ? null : (
        <>
          <IssueHeaderCard issue={issue} onShowWakeups={scrollToWakeups} />
          <IssueDescription issueId={issue.id} description={issue.description} />
          <IssueReactionRow issue={issue} />
          <SubIssuesSection issueId={issue.id} />
          <WakeupsSection
            issueId={issue.id}
            status={issue.status}
            defaultOpen={!highlightCommentId}
            expand={focusWakeups}
            onLayout={(e) => {
              wakeupsY.current = e.nativeEvent.layout.y;
              if (!wakeupsLandingDone.current) {
                const offset = wakeupsY.current;
                requestAnimationFrame(() => listRef.current?.scrollToOffset({ offset, animated: false }));
              }
            }}
          />
        </>
      )}
      <View className="px-4 pt-4 pb-2 border-t border-border flex-row items-center justify-between">
        <Text className="text-xs uppercase tracking-wider text-muted-foreground font-medium">
          {t("detail.activity")}
        </Text>
        {onOpenChat ? (
          <Pressable
            onPress={onOpenChat}
            accessibilityRole="button"
            className="min-h-[48px] justify-center -my-3 active:opacity-60"
          >
            <Text className="text-sm text-primary font-medium">{t("chat.open_as_chat")}</Text>
          </Pressable>
        ) : null}
      </View>
      {timelineLoading && (!entries || entries.length === 0) ? (
        <View className="py-6 items-center">
          <ActivityIndicator />
        </View>
      ) : null}
    </View>
  );

  // Row the Inbox deep-link lands on. Index into the rendered
  // data, i.e. after the "New" divider was injected.
  const landingIndex = useMemo(
    () => findLandingIndex(dataWithDivider, highlightCommentId),
    [dataWithDivider, highlightCommentId],
  );

  // When a fresh inbox deep-link arrives AND its target row is in the
  // loaded timeline, force a FlashList remount so `initialScrollIndex` is
  // applied with data present. If we mounted before data arrived,
  // FlashList's one-shot initial-scroll
  // (useRecyclerViewController.applyInitialScrollIndex, gated on
  // `initialScrollCompletedRef`) would have already declared completion at
  // length 0 and never re-fire. Switching the key when the target becomes
  // available under a live highlight is the cheapest way to re-arm it; WS
  // appends later don't change the key, so they never move the user.
  const flashListKey =
    landingIndex !== undefined ? `hl-${highlightNonce ?? "0"}` : "list";

  return (
    <ImageSequenceProvider blocks={imageBlocks}>
    {/* testID tells the e2e flow whether a landing is pending. */}
    <View className="flex-1" testID={timelineListTestID(
        landingIndex,
        timelineLoading && (!entries || entries.length === 0),
      )}>
      {/* Outer Pressable owns the "tap anywhere outside the selected
          comment to exit text-selection mode" gesture. Disabled when
          no comment is selected → layout-only wrapper, every tap passes
          through to cells / chips / reactions. Active state captures any
          tap that didn't fire an inner Pressable — selecting CommentBody
          renders without its own Pressable wrapper (see comment-card.tsx
          `if (isSelecting) return body;`), so taps on the selected
          comment dismiss too, matching iOS Notes / iMessage. Scroll
          gestures are unaffected. */}
      <Pressable
        onPress={
          selectingId
            ? () => useCommentSelectStore.getState().clear()
            : undefined
        }
        disabled={!selectingId}
        style={{ flex: 1 }}
      >
      <FlashList
        key={flashListKey}
        ref={listRef}
        data={dataWithDivider}
        keyExtractor={(row) => row.entry.id}
        ListHeaderComponent={ListHeader}
        // Drag-to-dismiss keyboard — when the user scrolls the timeline
        // while the composer keyboard is up, the keyboard slides down
        // interactively (iMessage / WhatsApp / Slack idiom). Pairs with the
        // composer's `onBlur` → auto-collapse to pill: scroll dismisses
        // keyboard → TextInput blurs → composer collapses if empty.
        keyboardDismissMode="on-drag"
        // Tap-on-row inside the list (long-press a comment, tap a
        // reaction) should still register even when the keyboard is up.
        keyboardShouldPersistTaps="handled"
        // Inbox deep-link lands on its comment row; without a
        // target the list opens at the header (title, description, status).
        initialScrollIndex={landingIndex}
        // FlashList v2 MVCP (on by default) keeps visible content stable
        // after the initial paint when upper rows resize via async
        // markdown / WS events; we do NOT set `autoscrollToBottomThreshold`
        // because timeline uses an explicit "↓ N new" chip instead of
        // silently following appends.
        // "Activity" is a section heading, not a sibling row — it should
        // hug the first entry the way iOS Settings / Linear sections do.
        // 4 px is just enough breathing room without making the heading
        // float above the list. (12 px = row-to-row gap, wrong here.)
        ListHeaderComponentStyle={{ marginBottom: 4 }}
        ItemSeparatorComponent={RowSeparator}
        renderItem={({ item, index }) => {
          if (item.entry.id === DIVIDER_ID) {
            return <UnreadDivider />;
          }
          const row = item.entry.type === "comment" ? (
            <CommentCard
              entry={item.entry}
              replies={item.replies}
              issueId={issue.id}
              issueIdentifier={issue.identifier}
              highlightedCommentId={highlightedId}
            />
          ) : (
            <ActivityRow entry={item.entry} />
          );
          // Marker for the e2e flow that checks the landing position.
          return index === landingIndex ? (
            <View testID="timeline-landing-target" collapsable={false}>
              {row}
            </View>
          ) : (
            row
          );
        }}
        onScroll={handleScroll}
        onContentSizeChange={handleContentSizeChange}
        onLayout={handleListLayout}
        // Any user-initiated scroll exits comment text-selection mode —
        // matches iMessage's behavior where scrolling implicitly commits /
        // dismisses the selection caret. Hooks both drag-start and the
        // momentum kick after a flick so a fast scroll can't escape.
        onScrollBeginDrag={() => {
          wakeupsLandingDone.current = true;
          stopJumpFollow();
          useCommentSelectStore.getState().clear();
        }}
        onMomentumScrollBegin={() =>
          useCommentSelectStore.getState().clear()
        }
        viewabilityConfigCallbackPairs={viewabilityCallbackPairs.current}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        contentContainerStyle={{ paddingBottom: 16 }}
      />
      </Pressable>
      {newCount > 0 ? (
        <NewCommentChip count={newCount} onPress={onJumpToLatest} />
      ) : null}
      {jumpVisible ? (
        <JumpToLatestButton count={newCount} onPress={onJumpToLatest} />
      ) : null}
    </View>
    </ImageSequenceProvider>
  );
}

/**
 * 12 px vertical gap between every timeline row. FlashList ignores
 * `gap-*` on `contentContainer`, so the spacing is supplied via this
 * separator component — same pattern as chat-message-list.tsx.
 */
function RowSeparator() {
  return <View style={{ height: 12 }} />;
}

/**
 * Horizontal rule + "New" pill spanning the row width. Drawn between the
 * last entry the user had seen on their previous visit and the first one
 * they haven't. Mirrors Slack / iMessage / Things' "unread divider"
 * idiom — a passive visual mark, not interactive (no tap-to-dismiss; it
 * disappears the next time the user scrolls past and unmounts the screen).
 */
function UnreadDivider() {
  const { t } = useT("issues");
  return (
    <View className="flex-row items-center gap-2 px-4">
      <View className="flex-1 h-px bg-destructive/40" />
      <Text className="text-[10px] uppercase tracking-wider font-medium text-destructive">
        {t("new_badge")}
      </Text>
      <View className="flex-1 h-px bg-destructive/40" />
    </View>
  );
}

/**
 * Floating "↓ N new" chip pinned above the composer area. Surfaces WS
 * arrivals the user can't currently see because they're scrolled up.
 * Tap → smooth scrollToEnd + reset counter. Reaching the bottom by hand
 * also clears it (see handleScroll above).
 *
 * Positioned absolute bottom-center inside the parent <View flex-1> wrap;
 * doesn't overlap content because the timeline's `contentContainer`
 * already has its own bottom padding for breathing room above the
 * composer hand-off.
 */
function NewCommentChip({
  count,
  onPress,
}: {
  count: number;
  onPress: () => void;
}) {
  const { colorScheme } = useColorScheme();
  const { t } = useT("issues");
  const fg = THEME[colorScheme].primaryForeground;
  return (
    <Pressable
      onPress={onPress}
      className="absolute bottom-3 self-center px-3.5 py-1.5 rounded-full bg-primary active:opacity-80 flex-row items-center gap-1.5"
      accessibilityRole="button"
      accessibilityLabel={t(
        count === 1 ? "jump_a11y_one" : "jump_a11y_other",
        { count },
      )}
      style={{
        // shadow comes from system, not Tailwind — keeps the chip readable
        // against either light or dark timeline content beneath.
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.18,
        shadowRadius: 6,
        elevation: 4,
      }}
    >
      <Ionicons name="arrow-down" size={14} color={fg} />
      <Text className="text-xs font-semibold text-primary-foreground">
        {count} new
      </Text>
    </Pressable>
  );
}

/**
 * Floating round "Jump to latest" button at the right edge above the
 * composer — the mobile adaptation of the desktop client's down arrow
 * (upstream web parity, MUL-8324/MUL-8951: a round outline button with an
 * ArrowDown icon in the composer dock). Shows while the reader is near the
 * top of a timeline whose newest entry is more than a screen away; the
 * badge counts the comments that arrived while the reader was away,
 * capped at 9+ like web's JUMP_COUNT_CAP.
 */
function JumpToLatestButton({
  count,
  onPress,
}: {
  count: number;
  onPress: () => void;
}) {
  const { colorScheme } = useColorScheme();
  const { t } = useT("issues");
  const fg = THEME[colorScheme].foreground;
  return (
    <Pressable
      onPress={onPress}
      testID="timeline-jump-to-latest"
      accessibilityRole="button"
      accessibilityLabel={
        count > 0
          ? t(count === 1 ? "jump_a11y_one" : "jump_a11y_other", { count })
          : t("jump_to_latest")
      }
      hitSlop={6}
      className="absolute bottom-3 right-4 h-10 w-10 items-center justify-center rounded-full border border-border bg-background active:opacity-80"
      style={{
        // shadow comes from system, not Tailwind — keeps the button
        // readable against either light or dark timeline content beneath.
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.18,
        shadowRadius: 6,
        elevation: 4,
      }}
    >
      <Ionicons name="arrow-down" size={20} color={fg} />
      {count > 0 ? (
        <View
          pointerEvents="none"
          className="absolute -right-1 -top-1 h-[18px] min-w-[18px] items-center justify-center rounded-full bg-primary px-1"
        >
          <Text className="text-[11px] font-semibold text-primary-foreground">
            {count > 9 ? "9+" : count}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}
