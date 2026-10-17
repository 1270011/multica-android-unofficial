/**
 * Board drag & drop for the "columns" layout.
 * Geometry and payload rules: lib/board-dnd.ts.
 *
 * - Gesture: RNGH Pan that activates only after a long press
 *   (DRAG_ACTIVATE_MS). Until then the horizontal board and the vertical
 *   column lists scroll as before; while a card is lifted the board stops
 *   scrolling by hand and scrolls itself near the edges.
 * - Callbacks run on the JS thread (`runOnJS(true)`) and the floating copy
 *   moves with RN `Animated`; the app uses no Reanimated worklets yet and a
 *   drag needs no 120 Hz precision.
 * - Release over another column → `useBoardStatusChange` (optimistic move,
 *   rollback, "Undo" toast as in C2a). Released without moving → the status
 *   menu, so the long press keeps its portrait meaning.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Animated,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ScrollView,
  View,
} from "react-native";
import { Gesture, type GestureType } from "react-native-gesture-handler";
import * as Haptics from "expo-haptics";
import type { Issue, IssueStatus } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { PriorityIcon } from "@/components/ui/priority-icon";
import type { BoardColumn } from "@/lib/board";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import {
  autoScrollStep,
  panUpdateAction,
  clampScroll,
  columnIndexAt,
  DRAG_ACTIVATE_MS,
  dropOutcome,
  type ColumnsGeometry,
} from "@/lib/board-dnd";

const AUTO_SCROLL_TICK_MS = 16;
/** Ignore the tap that the Pressable may report right after a drop. */
const PRESS_GUARD_MS = 400;

interface DragState {
  issue: Issue;
  hover: IssueStatus | null;
}

export function useBoardDrag({
  enabled,
  columns,
  columnWidth,
  paddingLeft,
  gap,
  onMove,
  onMenu,
}: {
  enabled: boolean;
  columns: BoardColumn[];
  columnWidth: number;
  paddingLeft: number;
  gap: number;
  onMove: (issue: Issue, to: IssueStatus) => void;
  onMenu: (issue: Issue) => void;
}) {
  const [drag, setDrag] = useState<DragState | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  const containerRef = useRef<View>(null);
  const scrollX = useRef(0);
  const contentWidth = useRef(0);
  const viewport = useRef({ x: 0, y: 0, width: 0 });
  const finger = useRef({ x: 0, y: 0 });
  const start = useRef({ x: 0, y: 0 });
  const hoverRef = useRef<IssueStatus | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastDrop = useRef(0);
  /** False once the drag was dropped by the reset effect below. */
  const alive = useRef(false);
  const pos = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];

  const geometry: ColumnsGeometry = { paddingLeft, columnWidth, gap, count: columns.length };
  const geometryRef = useRef(geometry);
  geometryRef.current = geometry;
  const columnsRef = useRef(columns);
  columnsRef.current = columns;

  // A lifted card can lose its gesture without onFinalize: rotation to
  // portrait (drag off), or a refetch/WS update moving or removing the
  // issue. Then drop the drag state, or the board stays unscrollable and
  // taps stay blocked.
  useEffect(() => {
    if (!drag) return;
    const column = columns.find((c) => c.status === drag.issue.status);
    const stillThere = !!column?.issues.some((i) => i.id === drag.issue.id);
    if (!enabled || !stillThere) {
      alive.current = false;
      stopAutoScroll();
      hoverRef.current = null;
      setDrag(null);
    }
  }, [enabled, columns, drag]);

  const stopAutoScroll = () => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
  };
  useEffect(() => stopAutoScroll, []);

  const updateHover = useCallback(() => {
    const xInBoard = finger.current.x - viewport.current.x;
    const index = columnIndexAt(xInBoard + scrollX.current, geometryRef.current);
    const status = index === null ? null : columnsRef.current[index]?.status ?? null;
    if (status !== hoverRef.current) {
      hoverRef.current = status;
      setDrag((d) => (d ? { ...d, hover: status } : d));
      if (status) void Haptics.selectionAsync().catch(() => {});
    }
  }, []);

  const tickAutoScroll = useCallback(() => {
    const xInBoard = finger.current.x - viewport.current.x;
    const step = autoScrollStep(xInBoard, viewport.current.width);
    if (step === 0) {
      stopAutoScroll();
      return;
    }
    const next = clampScroll(scrollX.current + step, contentWidth.current, viewport.current.width);
    if (next === scrollX.current) return;
    scrollX.current = next;
    scrollRef.current?.scrollTo({ x: next, animated: false });
    updateHover();
  }, [updateHover]);

  const moveFloating = (x: number, y: number) => {
    finger.current = { x, y };
    pos.setValue({
      x: x - viewport.current.x - columnWidth / 2,
      y: y - viewport.current.y - 28,
    });
  };

  const gestureFor = (issue: Issue): GestureType | undefined => {
    if (!enabled) return undefined;
    return Gesture.Pan()
      .activateAfterLongPress(DRAG_ACTIVATE_MS)
      .runOnJS(true)
      .onStart((e) => {
        start.current = { x: e.absoluteX, y: e.absoluteY };
        containerRef.current?.measureInWindow((x, y, width) => {
          viewport.current = { x, y, width };
          moveFloating(finger.current.x, finger.current.y);
          updateHover();
        });
        moveFloating(e.absoluteX, e.absoluteY);
        hoverRef.current = issue.status;
        alive.current = true;
        setDrag({ issue, hover: issue.status });
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
      })
      .onUpdate((e) => {
        const step = autoScrollStep(e.absoluteX - viewport.current.x, viewport.current.width);
        const action = panUpdateAction(alive.current, step, !!timer.current);
        if (action === "ignore") return;
        moveFloating(e.absoluteX, e.absoluteY);
        updateHover();
        if (action === "start") timer.current = setInterval(tickAutoScroll, AUTO_SCROLL_TICK_MS);
        if (action === "stop") stopAutoScroll();
      })
      .onEnd((e, success) => {
        // RNGH also calls onEnd for a cancelled gesture.
        if (!success || !alive.current) return;
        const distance = Math.hypot(e.absoluteX - start.current.x, e.absoluteY - start.current.y);
        const outcome = dropOutcome(issue.status, hoverRef.current, distance);
        if (outcome.kind === "move") onMove(issue, outcome.to);
        else if (outcome.kind === "menu") onMenu(issue);
      })
      .onFinalize((_e, success) => {
        alive.current = false;
        stopAutoScroll();
        if (success) lastDrop.current = Date.now();
        hoverRef.current = null;
        setDrag(null);
      });
  };

  /** Wrap a card's onPress so the release of a drag does not open it. */
  const guardPress = (fn: () => void) => () => {
    if (drag || Date.now() - lastDrop.current < PRESS_GUARD_MS) return;
    fn();
  };

  const scrollProps = {
    ref: scrollRef,
    scrollEnabled: !drag,
    scrollEventThrottle: 16,
    onScroll: (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      scrollX.current = e.nativeEvent.contentOffset.x;
    },
    onContentSizeChange: (w: number) => {
      contentWidth.current = w;
    },
  };

  const overlay = drag ? (
    <Animated.View
      pointerEvents="none"
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        width: columnWidth - 16,
        transform: pos.getTranslateTransform(),
        elevation: 8,
        zIndex: 10,
        gap: 6,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: theme.primary,
        backgroundColor: theme.card,
        paddingHorizontal: 12,
        paddingVertical: 10,
      }}
      importantForAccessibility="no-hide-descendants"
      testID="board-drag-card"
    >
      <View className="flex-row items-center gap-2">
        <PriorityIcon priority={drag.issue.priority} size={14} />
        <Text className="text-xs text-muted-foreground">{drag.issue.identifier}</Text>
      </View>
      <Text className="text-sm text-foreground" numberOfLines={2}>
        {drag.issue.title}
      </Text>
    </Animated.View>
  ) : null;

  return {
    drag,
    gestureFor,
    guardPress,
    scrollProps,
    containerRef,
    overlay,
  };
}
