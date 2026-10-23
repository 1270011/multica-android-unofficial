/**
 * Scrolling message list of the issue chat.
 *
 * FlashList v2 like `components/chat/chat-message-list.tsx`: starts at the
 * bottom (`startRenderingFromBottom`) and follows new rows while the reader
 * is near the end (`autoscrollToBottomThreshold`). Scrolled up, new rows are
 * counted into a "↓ N new" chip instead. On open it jumps once to the target
 * comment (`?comment=`, flashed) or else to the unread divider. The landing
 * puts the row's top edge at the top of the window and corrects it after the
 * rows above got measured; until the reader drags, the bottom-follow only
 * fires exactly at the end so it cannot undo the jump
 * (`lib/chat-anchor.ts`).
 *
 * The first commit renders only the last rows (`lib/chat-window.ts`).
 * Older rows are prepended block by block: when the
 * reader scrolls near the window's top, one block per frame toward a landing
 * target or quote root, and slowly while idle when a screen reader is on.
 * Landings wait for the first frame and for their target inside the window.
 * While the cover stands or a landing is anchored, that growth waits:
 * the small first window settles sooner, and no block is
 * prepended under a landing.
 *
 * Until FlashList stands at the end, a plain bottom-aligned copy of the last
 * rows covers it (`lib/chat-first-frame.ts`): the bubbles are on
 * screen with the first frame instead of after the initial scroll.
 * After that hand-over the list is held at its end until the reader drags
 * (`EndHold`): prepending the held-back block and measuring the
 * rows above it left the list short of the end in about every second reopen.
 *
 * Reaching the end reports `onReachEnd` so the screen can mark the issue's
 * inbox entries read. New messages are announced to screen readers only
 * while the reader is at the end (hidden polite live region, not the list).
 */
import { startTransition, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Pressable,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { FlashList, type FlashListRef } from "@shopify/flash-list";
import { Ionicons } from "@/components/ui/ionicons";
import { Text } from "@/components/ui/text";
import { Skeleton } from "@/components/ui/skeleton";
import type { ChatItem } from "@/lib/issue-chat";
import { useCommentSelectStore } from "@/data/comment-select-store";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import {
  ANCHOR_RECHECK_MS,
  ANCHOR_TOP_GAP_PX,
  ANCHOR_SETTLE_MS,
  ANCHOR_HOLD_MS,
  ANCHOR_TOLERANCE_PX,
  anchorHolds,
  anchorIsEnd,
  anchorNeedsCorrection,
  anchorScrollParams,
  anchorTargetOffset,
  autoscrollThreshold,
  newMessagesFollow,
} from "@/lib/chat-anchor";
import {
  CHAT_IDLE_MS,
  CHAT_IDLE_STEP,
  chatWindowStart,
  grownWindowStart,
  windowStepTowards,
  WindowGrowthGate,
} from "@/lib/chat-window";
import { useT } from "@/lib/i18n";
import { useKeyboardState } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { chatKeyboardInset } from "@/lib/chat-keyboard";
import { ChatBubble } from "./chat-bubble";
import { SystemGroup, SystemLine } from "./system-line";
import { formatChatDay } from "./format";
import { PERF_MARKS_ON, perfMark } from "@/lib/perf-mark";
import {
  COVER_FALLBACK_MS,
  COVER_MAX_MS,
  COVER_TOUCH_PROPS,
  CoverHandOver,
  coverMode,
  END_HOLD_RECHECK_MS,
  EndHold,
  liveCover,
  NativeScrollState,
  nativeStandsAtEnd,
} from "@/lib/chat-first-frame";
import { createProbeScrollView } from "./probe-scroll-view";

const AT_BOTTOM_SLACK_PX = 80;
const HIGHLIGHT_MS = 3000;

interface Props {
  items: ChatItem[];
  issueId: string;
  issueIdentifier: string | undefined;
  /** Comment to land on and flash (deep link / inbox anchor). */
  targetCommentId?: string;
  /** Changes on every inbox tap so re-opening the same target re-fires. */
  targetNonce?: string;
  onExpandGroup: (groupId: string) => void;
  onReachEnd: () => void;
  footer?: React.ReactElement;
}

export function IssueChatList({
  items,
  issueId,
  issueIdentifier,
  targetCommentId,
  targetNonce,
  onExpandGroup,
  onReachEnd,
  footer,
}: Props) {
  const { t } = useT("issues");
  const listRef = useRef<FlashListRef<ChatItem>>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [newCount, setNewCount] = useState(0);
  const [announce, setAnnounce] = useState("");
  const atBottomRef = useRef(true);
  const messageCount = useMemo(
    () => items.filter((i) => i.kind === "message").length,
    [items],
  );
  const lastCountRef = useRef(messageCount);

  const flash = useCallback((id: string) => {
    setHighlightId(id);
    setTimeout(() => setHighlightId((cur) => (cur === id ? null : cur)), HIGHLIGHT_MS);
  }, []);

  // First commit: only the last rows (plus a landing target just above
  // them); older rows follow block by block. Keyed by
  // issue so switching issues in place starts with a window again.
  const [readyFor, setReadyFor] = useState<string | null>(null);
  const ready = readyFor === issueId;
  const focusId = targetCommentId ?? "unread";
  // The window's top row on screen: a data change only appends to the
  // window; growing moves it up by one block.
  const [windowTop, setWindowTop] = useState<WindowTop | null>(null);
  const top = windowTop?.issueId === issueId ? windowTop : null;
  const start = chatWindowStart(items, {
    focusId: top ? null : focusId,
    keepFromId: top?.id,
    keepFromEnd: top?.fromEnd,
  });
  // Keyed by `start`: recording the top row does not hand the list a new array.
  const data = useMemo(() => (start === 0 ? items : items.slice(start)), [items, start]);
  perfMark(() => `list:render items=${items.length} start=${start} data=${data.length} ready=${ready}`);
  useEffect(() => {
    perfMark("list:mount");
    return () => perfMark("list:unmount");
  }, []);
  useLayoutEffect(() => perfMark("list:commit"));
  const allRef = useRef(items);
  allRef.current = items;
  const startRef = useRef(start);
  startRef.current = start;
  useEffect(() => {
    const first = data[0];
    if (!first) return;
    setWindowTop((cur) =>
      cur?.issueId === issueId && cur.id === first.id && cur.fromEnd === data.length
        ? cur
        : { issueId, id: first.id, fromEnd: data.length },
    );
  }, [data, issueId]);
  useEffect(() => {
    if (ready || items.length === 0) return;
    const raf = requestAnimationFrame(() => setReadyFor(issueId));
    return () => cancelAnimationFrame(raf);
  }, [ready, items.length, issueId]);
  const growTo = useCallback(
    (next: number) => {
      const all = allRef.current;
      const row = all[next];
      if (!row || next >= startRef.current) return;
      startTransition(() => setWindowTop({ issueId, id: row.id, fromEnd: all.length - next }));
    },
    [issueId],
  );
  // Read in `onStartReached` before the cover and anchor below exist.
  const coverUpRef = useRef(false);
  const anchoredRef = useRef(false);
  const [growthGate] = useState(
    () => new WindowGrowthGate(() => coverUpRef.current || anchoredRef.current),
  );
  const onStartReached = useCallback(() => {
    if (startRef.current === 0) return;
    if (growthGate.request()) growTo(grownWindowStart(startRef.current));
    else perfMark("list:grow-held");
  }, [growTo, growthGate]);

  // Read through a ref so `scrollTo` → `onPressQuote` → `renderItem` keep
  // their identity across refetches; a new `renderItem` would
  // re-render every visible row. Indexes refer to the rendered rows.
  const itemsRef = useRef(data);
  itemsRef.current = data;
  // Anchored = a landing holds the view; cleared when the reader drags or
  // jumps to the end. Turns the bottom-follow down (see `autoscrollThreshold`).
  const [anchored, setAnchored] = useState(false);
  const anchorIdRef = useRef<string | null>(null);
  const anchoredAtRef = useRef<number | null>(null);
  const recheckRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const settleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearTimers = useCallback(() => {
    recheckRef.current.forEach(clearTimeout);
    recheckRef.current = [];
    if (settleRef.current) clearTimeout(settleRef.current);
    settleRef.current = null;
  }, []);
  const releaseAnchor = useCallback(() => {
    clearTimers();
    anchorIdRef.current = null;
    anchoredAtRef.current = null;
    anchoredRef.current = false;
    setAnchored(false);
  }, [clearTimers]);
  useEffect(() => clearTimers, [clearTimers]);

  // Native scroll values, not FlashList's: its initial scroll does not
  // reach `onScroll` and its JS offset stays stale.
  const [nativeScroll] = useState(() => new NativeScrollState());
  // An open at the end stays there while the held-back block is prepended
  // and the rows above get measured.
  const [endHold] = useState(() => new EndHold());
  const endTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const armEndHold = useCallback(() => {
    endHold.arm(Date.now());
    endTimersRef.current.forEach(clearTimeout);
    endTimersRef.current = END_HOLD_RECHECK_MS.map((ms) =>
      setTimeout(() => {
        const end = endHold.endOffset(nativeScroll.probe(), Date.now());
        if (end !== null) listRef.current?.scrollToEnd({ animated: false });
      }, ms),
    );
  }, [endHold, nativeScroll]);
  const releaseEndHold = useCallback(() => {
    endHold.release();
    endTimersRef.current.forEach(clearTimeout);
    endTimersRef.current = [];
  }, [endHold]);
  useEffect(() => releaseEndHold, [releaseEndHold]);
  // TalkBack's scroll action starts no drag; see `onNativeScroll`.
  const screenReader = useScreenReader();
  const screenReaderRef = useRef(screenReader);
  screenReaderRef.current = screenReader;

  // Land again if the anchored row's top is no longer where it should be
  // (rows above measured, late footer, FlashList's own bottom-follow). The
  // offset is the native one: with the stale JS offset a late jump to the
  // end went unseen and the landing was lost.
  const correctAnchor = useCallback(() => {
    const id = anchorIdRef.current;
    const l = listRef.current;
    if (!id || !l) return;
    const i = itemsRef.current.findIndex((it) => it.id === id);
    const layout = i >= 0 ? l.getLayout(i) : undefined;
    if (!layout) return;
    const native = nativeScroll.probe();
    const measure = {
      itemTop: layout.y,
      firstItemOffset: l.getFirstItemOffset(),
      scrollOffset: native?.offset ?? l.getAbsoluteLastScrollOffset(),
      contentHeight: l.getChildContainerDimensions().height,
      windowHeight: native?.viewport ?? l.getWindowSize().height,
      scrollHeight: native?.content,
    };
    if (id === "unread" && anchorIsEnd(measure)) {
      // Divider in the last screen: the landing is the native end, with
      // footer. Held like a landing while rows get measured; the
      // hold's end releases it so the list follows again.
      const end = native ? Math.max(0, native.content - native.viewport) : null;
      if (end === null || Math.abs(end - measure.scrollOffset) <= ANCHOR_TOLERANCE_PX) return;
      perfMark(`list:anchor-end off=${measure.scrollOffset} end=${end}`);
      l.scrollToOffset({ offset: end, animated: false });
      return;
    }
    if (!anchorNeedsCorrection(measure)) return;
    perfMark(`list:anchor-fix off=${measure.scrollOffset} aim=${anchorTargetOffset(measure)}`);
    void l.scrollToIndex(anchorScrollParams(i));
  }, [nativeScroll]);
  const markAnchorHeld = useCallback(() => {
    const id = anchorIdRef.current;
    const l = listRef.current;
    const i = id && l ? itemsRef.current.findIndex((it) => it.id === id) : -1;
    const layout = l && i >= 0 ? l.getLayout(i) : undefined;
    if (!l || !layout) return;
    const native = nativeScroll.probe();
    const off = native?.offset ?? l.getAbsoluteLastScrollOffset();
    const aim = anchorTargetOffset({
      itemTop: layout.y,
      firstItemOffset: l.getFirstItemOffset(),
      scrollOffset: off,
      contentHeight: l.getChildContainerDimensions().height,
      windowHeight: native?.viewport ?? l.getWindowSize().height,
      scrollHeight: native?.content,
    });
    perfMark(`list:anchor-held ${Math.abs(aim - off) <= ANCHOR_TOLERANCE_PX ? "ok" : "lost"} off=${off} aim=${aim}`);
  }, [nativeScroll]);
  // A scroll the reader did not start while anchored: re-check once it
  // settles. Fed by `onScroll` and by the native events FlashList drops.
  const settleAnchor = useCallback(() => {
    if (!anchorHolds(anchoredAtRef.current, Date.now())) return;
    if (settleRef.current) clearTimeout(settleRef.current);
    settleRef.current = setTimeout(correctAnchor, ANCHOR_SETTLE_MS);
  }, [correctAnchor]);

  const scrollTo = useCallback(
    (id: string) => {
      const index = itemsRef.current.findIndex((i) => i.id === id);
      const list = listRef.current;
      if (index < 0 || !list) return false;
      clearTimers();
      releaseEndHold();
      anchorIdRef.current = id;
      anchoredAtRef.current = Date.now();
      anchoredRef.current = true;
      setAnchored(true);
      void list.scrollToIndex(anchorScrollParams(index));
      recheckRef.current = ANCHOR_RECHECK_MS.map((ms) => setTimeout(correctAnchor, ms));
      // The unread divider at the end holds only while rows settle.
      if (id === "unread") {
        recheckRef.current.push(
          setTimeout(() => {
            const p = nativeScroll.probe();
            if (anchorIdRef.current === "unread" && p && nativeStandsAtEnd(p, AT_BOTTOM_SLACK_PX)) releaseAnchor();
          }, ANCHOR_HOLD_MS),
        );
      }
      // Measuring only: does the landing still hold after the hold time?
      if (PERF_MARKS_ON) recheckRef.current.push(setTimeout(markAnchorHeld, ANCHOR_HOLD_MS + 500));
      return true;
    },
    [clearTimers, correctAnchor, markAnchorHeld, nativeScroll, releaseAnchor, releaseEndHold],
  );

  // Cover: decided once per issue on the first render, so a
  // refetch does not bring it back. Its rows follow the data.
  // Landing on a target or the unread divider in the first window gets a
  // cover from the target down.
  const [coverFor, setCoverFor] = useState(() => ({
    issueId,
    mode: coverMode(items, { targetCommentId, windowStart: start }),
  }));
  if (coverFor.issueId !== issueId) {
    // Another issue in place: state adjusted during render, no extra commit.
    setCoverFor({ issueId, mode: coverMode(items, { targetCommentId, windowStart: start }) });
  }
  const coverModeNow = coverFor.issueId === issueId ? coverFor.mode : null;
  const coverOn = coverModeNow !== null;
  coverUpRef.current = coverOn;
  const cover = liveCover(coverModeNow, items);
  const coverTargetRef = useRef<string | null>(null);
  coverTargetRef.current = coverModeNow?.kind === "landing" ? coverModeNow.targetId : null;
  const onNativeScroll = useRef(() => {});
  const [ProbeScrollView] = useState(() =>
    createProbeScrollView(
      nativeScroll,
      () => onNativeScroll.current(),
      () => anchoredRef.current,
      () => perfMark(`list:hold-end off=${nativeScroll.offset} content=${nativeScroll.content}`),
    ),
  );
  // Landing: no probe until the jump to the target ran, then with the
  // offset at which its top sits at the landing gap (list layout).
  const probeEnd = useCallback(() => {
    const p = nativeScroll.probe();
    const target = coverTargetRef.current;
    if (!p || !target) return p;
    const l = listRef.current;
    if (!l || anchorIdRef.current !== target) return null;
    const i = itemsRef.current.findIndex((it) => it.id === target);
    const layout = i >= 0 ? l.getLayout(i) : undefined;
    if (!layout) return null;
    return { ...p, aim: layout.y + l.getFirstItemOffset() - ANCHOR_TOP_GAP_PX };
  }, [nativeScroll]);
  const handOverRef = useRef<{ issueId: string; h: CoverHandOver } | null>(null);
  if (handOverRef.current?.issueId !== issueId) {
    const h = new CoverHandOver(
      (reason) => {
        const p = probeEnd();
        perfMark(`list:cover-off ${reason} off=${p?.offset} win=${p?.viewport} content=${p?.content} aim=${p?.aim}`);
        if (!coverTargetRef.current && reason !== "unmount") armEndHold();
        setCoverFor((cur) => (cur.issueId === issueId && cur.mode ? { issueId, mode: null } : cur));
      },
      (cb) => requestAnimationFrame(cb),
      probeEnd,
    );
    handOverRef.current = { issueId, h };
  }
  const handOver = handOverRef.current.h;
  onNativeScroll.current = () => {
    settleAnchor();
    if (nativeScroll.takeScrolledUp() && screenReaderRef.current && endHold.active(Date.now())) {
      perfMark(`list:end-hold-release a11y off=${nativeScroll.offset}`);
      releaseEndHold();
    }
    const endAim = endHold.correction(nativeScroll.probe(), Date.now());
    if (endAim !== null) {
      perfMark(`list:end-hold off=${nativeScroll.offset} end=${endAim}`);
      listRef.current?.scrollToEnd({ animated: false });
    }
    if (!coverOn || !handOver.active) return;
    const l = listRef.current;
    perfMark(
      () => `list:native off=${nativeScroll.offset} win=${nativeScroll.viewport} content=${nativeScroll.content} js=${l?.getAbsoluteLastScrollOffset()}/${l?.getWindowSize().height}`,
    );
    handOver.check(true);
  };
  perfMark(
    () => `list:cover ${cover ? `${coverModeNow?.kind} ${cover.above.length}+${cover.from.length}` : "off"}`,
  );
  // With a cover the list mounts one frame later: the cover is painted first.
  const [listFor, setListFor] = useState<string | null>(coverOn ? null : issueId);
  const showList = !coverOn || listFor === issueId;
  useEffect(() => {
    if (showList) return;
    const raf = requestAnimationFrame(() => setListFor(issueId));
    return () => cancelAnimationFrame(raf);
  }, [showList, issueId]);
  // A screen reader walks rows one by one: fill the rest in small idle
  // blocks so every row is reachable without a scroll gesture. Not under
  // the cover: its window stays small until the list stands.
  useEffect(() => {
    if (!screenReader || !ready || start === 0 || coverOn) return;
    const timer = setTimeout(() => growTo(grownWindowStart(start, CHAT_IDLE_STEP)), CHAT_IDLE_MS);
    return () => clearTimeout(timer);
  }, [screenReader, ready, start, growTo, coverOn]);
  // The block held back while the cover stood or the landing held.
  useEffect(() => {
    if (coverOn || anchored || !growthGate.release() || startRef.current === 0) return;
    perfMark("list:grow-released");
    // Still held at the end since the hand-over: hold on while it settles.
    if (endHold.active(Date.now())) armEndHold();
    const raf = requestAnimationFrame(() => growTo(grownWindowStart(startRef.current)));
    return () => cancelAnimationFrame(raf);
  }, [coverOn, anchored, growthGate, growTo, endHold, armEndHold]);
  useEffect(() => {
    if (!coverOn) return;
    const t = setTimeout(() => handOver.off("max"), COVER_MAX_MS);
    return () => clearTimeout(t);
  }, [coverOn, handOver]);
  useEffect(() => {
    if (!coverOn) return;
    return () => handOver.off("unmount");
  }, [coverOn, handOver]);
  // Measuring only: JS frames that came late while the cover stands.
  useEffect(() => {
    if (!PERF_MARKS_ON || !coverOn) return;
    let last = Date.now();
    let raf = requestAnimationFrame(function tick() {
      const now = Date.now();
      if (now - last > 50) perfMark(`list:js-gap ${now - last}ms`);
      last = now;
      raf = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(raf);
  }, [coverOn]);
  // Fallback after the list's first layout, on a landing after the jump: it
  // can come ~1 s after `onLoad` while the list renders its rows.
  const fallbackRef = useRef<CoverHandOver | null>(null);
  const armFallback = useCallback(() => {
    if (fallbackRef.current === handOver || !handOver.active) return;
    fallbackRef.current = handOver;
    setTimeout(() => handOver.off("fallback"), COVER_FALLBACK_MS);
  }, [handOver]);
  // One landing per (target, nonce) once the full list is rendered. The
  // stamp is set only when the landing runs: a refetch inside the delay
  // restarts the timer instead of swallowing the jump (seen at 200 % font
  // scale).
  const landedRef = useRef<string | null>(null);
  useEffect(() => {
    // The list mounts a frame after a cover: land once it is there.
    if (!ready || !showList || items.length === 0) return;
    const stamp = `${targetCommentId ?? ""}:${targetNonce ?? ""}`;
    if (landedRef.current === stamp) return;
    // A target above the window: open one block per frame until it is in.
    const want =
      targetCommentId && items.some((i) => i.id === targetCommentId)
        ? targetCommentId
        : items.some((i) => i.kind === "unread")
          ? "unread"
          : null;
    const next = want ? windowStepTowards(items, start, want) : null;
    if (next !== null) {
      const raf = requestAnimationFrame(() => growTo(next));
      return () => cancelAnimationFrame(raf);
    }
    const timer = setTimeout(() => {
      landedRef.current = stamp;
      const landed =
        targetCommentId && scrollTo(targetCommentId)
          ? targetCommentId
          : itemsRef.current.some((i) => i.kind === "unread") && scrollTo("unread")
            ? "unread"
            : null;
      if (landed && landed === targetCommentId) flash(landed);
      if (landed && landed === coverTargetRef.current) {
        perfMark(`list:landed ${landed === "unread" ? "unread" : "comment"}`);
        armFallback();
        handOver.check();
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [items, start, ready, showList, targetCommentId, targetNonce, scrollTo, flash, growTo, armFallback, handOver]);

  useEffect(() => {
    const diff = messageCount - lastCountRef.current;
    lastCountRef.current = messageCount;
    if (diff <= 0) return;
    // Your own new message ends the anchor hold and follows to the end.
    const last = itemsRef.current[itemsRef.current.length - 1];
    if (last?.kind === "message" && last.own && anchoredRef.current) {
      releaseAnchor();
      requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
    }
    if (newMessagesFollow(atBottomRef.current, anchoredRef.current)) {
      setAnnounce(t(diff === 1 ? "chat.new_one" : "chat.new_other", { count: diff }));
    } else {
      setNewCount((n) => n + diff);
    }
  }, [messageCount, t, releaseAnchor]);

  const onLoad = useCallback(
    ({ elapsedTimeInMs }: { elapsedTimeInMs: number }) => {
      perfMark(`list:onLoad ${Math.round(elapsedTimeInMs)}ms`);
      if (!coverOn || !handOver.active) return;
      if (!coverTargetRef.current) armFallback();
      handOver.markLoaded();
    },
    [coverOn, handOver, armFallback],
  );
  const onCommitLayoutEffect = useCallback(() => {
    if (coverOn && handOver.active) handOver.check();
  }, [coverOn, handOver]);
  const onCoverTouch = useCallback(() => {
    handOver.check();
    return true;
  }, [handOver]);

  const onScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
      const dist = contentSize.height - (contentOffset.y + layoutMeasurement.height);
      if (coverOn && handOver.active) handOver.check();
      const was = atBottomRef.current;
      atBottomRef.current = dist < AT_BOTTOM_SLACK_PX;
      settleAnchor();
      if (!was && atBottomRef.current) {
        setNewCount(0);
        onReachEnd();
      }
    },
    [onReachEnd, settleAnchor, coverOn, handOver],
  );

  const jumpToEnd = useCallback(() => {
    releaseAnchor();
    listRef.current?.scrollToEnd({ animated: true });
    setNewCount(0);
    onReachEnd();
  }, [onReachEnd, releaseAnchor]);

  // A quote whose root is above the window opens it block by block.
  const [pendingQuote, setPendingQuote] = useState<string | null>(null);
  const onPressQuote = useCallback(
    (rootId: string) => {
      releaseEndHold();
      if (scrollTo(rootId)) flash(rootId);
      else setPendingQuote(rootId);
    },
    [scrollTo, flash, releaseEndHold],
  );
  useEffect(() => {
    if (!pendingQuote) return;
    const next = windowStepTowards(items, start, pendingQuote);
    if (next !== null) {
      const raf = requestAnimationFrame(() => growTo(next));
      return () => cancelAnimationFrame(raf);
    }
    setPendingQuote(null);
    if (scrollTo(pendingQuote)) flash(pendingQuote);
  }, [pendingQuote, items, start, growTo, scrollTo, flash]);

  const onScrollBeginDrag = useCallback(() => {
    releaseEndHold();
    releaseAnchor();
    useCommentSelectStore.getState().clear();
  }, [releaseAnchor, releaseEndHold]);

  const mvcp = useMemo(
    () => ({
      autoscrollToBottomThreshold: autoscrollThreshold(anchored),
      startRenderingFromBottom: true,
    }),
    [anchored],
  );

  const renderItem = useCallback(
    ({ item }: { item: ChatItem }) => {
      switch (item.kind) {
        case "day":
          return (
            <View className="items-center py-1" accessibilityRole="header">
              <Text className="text-[11px] font-medium text-muted-foreground px-3 py-1 rounded-full bg-muted/60">
                {formatChatDay(item.day)}
              </Text>
            </View>
          );
        case "unread":
          return (
            <View className="flex-row items-center gap-2 px-4" accessible accessibilityLabel={t("chat.unread_divider")}>
              <View className="flex-1 h-px bg-destructive/40" />
              <Text className="text-[11px] uppercase tracking-wider font-medium text-destructive">
                {t("chat.unread_divider")}
              </Text>
              <View className="flex-1 h-px bg-destructive/40" />
            </View>
          );
        case "system":
          return <SystemLine entry={item.entry} emphasis={item.emphasis} />;
        case "system-group":
          return <SystemGroup groupId={item.id} entries={item.entries} onExpand={onExpandGroup} />;
        case "message":
          return (
            <ChatBubble
              entry={item.entry}
              issueId={issueId}
              issueIdentifier={issueIdentifier}
              own={item.own}
              groupStart={item.groupStart}
              replyTo={item.replyTo}
              mentionsMe={item.mentionsMe}
              resolved={item.resolved}
              highlighted={highlightId === item.id}
              onPressQuote={onPressQuote}
            />
          );
      }
    },
    [issueId, issueIdentifier, highlightId, onPressQuote, onExpandGroup, t],
  );

  // The composer only slides up with the keyboard: shorten the list by as
  // much, so the end stays above the keyboard.
  const keyboardVisible = useKeyboardState((k) => k.isVisible);
  const keyboardHeight = useKeyboardState((k) => k.height);
  const keyboardInset = chatKeyboardInset(keyboardVisible, keyboardHeight, useSafeAreaInsets().bottom);

  return (
    <View className="flex-1" style={{ paddingBottom: keyboardInset }}>
      {showList ? (
      <FlashList
        ref={listRef}
        data={data}
        keyExtractor={(item) => item.id}
        getItemType={(item) => item.kind}
        extraData={highlightId}
        renderItem={renderItem}
        maintainVisibleContentPosition={mvcp}
        ItemSeparatorComponent={Separator}
        // The element itself: a new wrapper component per render would
        // remount the footer on every list render.
        ListFooterComponent={footer}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        onScroll={onScroll}
        renderScrollComponent={ProbeScrollView}
        onStartReached={onStartReached}
        // One screen ahead: the next block is in before the reader hits the top.
        onStartReachedThreshold={1}
        onLoad={onLoad}
        onCommitLayoutEffect={onCommitLayoutEffect}
        onScrollBeginDrag={onScrollBeginDrag}
        contentContainerStyle={{ paddingTop: 12, paddingBottom: 12 }}
      />
      ) : null}
      {cover ? (
        // Same rows, separators, footer and paddings as the list where it
        // lands. `above` takes the space left, bottom-aligned (end, or a
        // landing the list cannot scroll up to the top); `from` starts at the
        // top with the landing gap and is cut off below.
        // Hidden from screen readers (the list below is the real one). Takes
        // every touch itself, so none reaches a bubble below.
        <View
          {...COVER_TOUCH_PROPS}
          onStartShouldSetResponder={onCoverTouch}
          importantForAccessibility="no-hide-descendants"
          accessibilityElementsHidden
          className="absolute inset-0 bg-background overflow-hidden"
        >
          {cover.reachesEnd ? (
            <View className="justify-end overflow-hidden" style={{ flex: 1, minHeight: 0 }}>
              {cover.above.map((item, i) => (
                <View key={item.id}>
                  {i > 0 ? <Separator /> : null}
                  {renderItem({ item })}
                </View>
              ))}
            </View>
          ) : null}
          <View style={{ flexShrink: 0 }}>
            {cover.from.map((item, i) => (
              <View key={item.id}>
                {i > 0 || cover.above.length > 0 ? <Separator /> : <View style={{ height: ANCHOR_TOP_GAP_PX }} />}
                {renderItem({ item })}
              </View>
            ))}
            {cover.reachesEnd ? (
              <>
                {footer}
                <View style={{ height: 12 }} />
              </>
            ) : null}
          </View>
        </View>
      ) : null}
      {newCount > 0 ? <NewChip count={newCount} onPress={jumpToEnd} /> : null}
      {/* Off-screen polite announcement for arrivals while at the end. */}
      <Text
        accessibilityLiveRegion="polite"
        importantForAccessibility="yes"
        style={{ position: "absolute", width: 1, height: 1, opacity: 0 }}
      >
        {announce}
      </Text>
    </View>
  );
}

interface WindowTop {
  issueId: string;
  id: string;
  fromEnd: number;
}

function useScreenReader(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    let alive = true;
    void AccessibilityInfo.isScreenReaderEnabled().then((v) => {
      if (alive) setOn(v);
    });
    const sub = AccessibilityInfo.addEventListener("screenReaderChanged", setOn);
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);
  return on;
}

function Separator() {
  return <View style={{ height: 8 }} />;
}

function NewChip({ count, onPress }: { count: number; onPress: () => void }) {
  const { colorScheme } = useColorScheme();
  const { t } = useT("issues");
  const fg = THEME[colorScheme].primaryForeground;
  const label = t(count === 1 ? "chat.new_one" : "chat.new_other", { count });
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      className="absolute bottom-3 self-center min-h-[40px] px-4 rounded-full bg-primary active:opacity-80 flex-row items-center gap-1.5"
      style={{
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.18,
        shadowRadius: 6,
        elevation: 4,
      }}
    >
      <Ionicons name="arrow-down" size={14} color={fg} />
      <Text className="text-xs font-semibold text-primary-foreground">{label}</Text>
    </Pressable>
  );
}

/** Three skeleton bubbles while the timeline loads. */
export function IssueChatLoading() {
  return (
    <View className="flex-1 justify-end gap-3 px-3 pb-4">
      <Skeleton className="h-12 w-2/3 rounded-2xl" />
      <Skeleton className="h-16 w-3/4 rounded-2xl" />
      <View className="items-end">
        <Skeleton className="h-10 w-1/2 rounded-2xl" />
      </View>
    </View>
  );
}
