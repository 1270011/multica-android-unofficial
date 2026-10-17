/**
 * Scrolling message list of the issue chat.
 *
 * FlashList v2 like `components/chat/chat-message-list.tsx`: starts at the
 * bottom (`startRenderingFromBottom`) and follows new rows while the reader
 * is near the end (`autoscrollToBottomThreshold`). Scrolled up, new rows are
 * counted into a "↓ N new" chip instead. On open it jumps once to the target
 * comment (`?comment=`, flashed) or else to the unread divider; both use the
 * estimate-based `scrollToIndex` with a centred view position, which is close
 * enough for a single landing (see timeline-list.tsx for why the detail does
 * not try to land precisely).
 *
 * Reaching the end reports `onReachEnd` so the screen can mark the issue's
 * inbox entries read. New messages are announced to screen readers only
 * while the reader is at the end (hidden polite live region, not the list).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
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
import { useT } from "@/lib/i18n";
import { ChatBubble } from "./chat-bubble";
import { SystemGroup, SystemLine } from "./system-line";
import { formatChatDay } from "./format";

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
  footer?: React.ReactNode;
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

  const scrollTo = useCallback(
    (id: string, viewPosition = 0.4) => {
      const index = items.findIndex((i) => i.id === id);
      if (index < 0) return false;
      listRef.current?.scrollToIndex({ index, animated: true, viewPosition });
      return true;
    },
    [items],
  );

  // One landing per (target, nonce) once rows exist.
  const landedRef = useRef<string | null>(null);
  useEffect(() => {
    if (items.length === 0) return;
    const stamp = `${targetCommentId ?? ""}:${targetNonce ?? ""}`;
    if (landedRef.current === stamp) return;
    landedRef.current = stamp;
    const timer = setTimeout(() => {
      if (targetCommentId && scrollTo(targetCommentId)) {
        flash(targetCommentId);
        return;
      }
      if (items.some((i) => i.kind === "unread")) scrollTo("unread", 0.1);
    }, 250);
    return () => clearTimeout(timer);
  }, [items, targetCommentId, targetNonce, scrollTo, flash]);

  useEffect(() => {
    const diff = messageCount - lastCountRef.current;
    lastCountRef.current = messageCount;
    if (diff <= 0) return;
    if (atBottomRef.current) {
      setAnnounce(t(diff === 1 ? "chat.new_one" : "chat.new_other", { count: diff }));
    } else {
      setNewCount((n) => n + diff);
    }
  }, [messageCount, t]);

  const onScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
      const dist = contentSize.height - (contentOffset.y + layoutMeasurement.height);
      const was = atBottomRef.current;
      atBottomRef.current = dist < AT_BOTTOM_SLACK_PX;
      if (!was && atBottomRef.current) {
        setNewCount(0);
        onReachEnd();
      }
    },
    [onReachEnd],
  );

  const jumpToEnd = useCallback(() => {
    listRef.current?.scrollToEnd({ animated: true });
    setNewCount(0);
    onReachEnd();
  }, [onReachEnd]);

  const onPressQuote = useCallback(
    (rootId: string) => {
      if (scrollTo(rootId)) flash(rootId);
    },
    [scrollTo, flash],
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
          return <SystemGroup entries={item.entries} onExpand={() => onExpandGroup(item.id)} />;
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

  return (
    <View className="flex-1">
      <FlashList
        ref={listRef}
        data={items}
        keyExtractor={(item) => item.id}
        getItemType={(item) => item.kind}
        extraData={highlightId}
        renderItem={renderItem}
        maintainVisibleContentPosition={{
          autoscrollToBottomThreshold: 0.2,
          startRenderingFromBottom: true,
        }}
        ItemSeparatorComponent={Separator}
        ListFooterComponent={footer ? () => <>{footer}</> : undefined}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        onScroll={onScroll}
        onScrollBeginDrag={() => useCommentSelectStore.getState().clear()}
        contentContainerStyle={{ paddingTop: 12, paddingBottom: 12 }}
      />
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
