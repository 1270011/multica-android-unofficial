/**
 * Issue board. Columns by status from
 * lib/board.ts; the layout follows the window and the system font size:
 *
 * - "pager"    portrait phone: one column per screen, snapping, the next
 *              column's edge visible; the column bar above shows
 *              "Status · count" and follows the swipe.
 * - "selector" portrait phone at ≥ 150 % font: one row "‹ Todo · 7 ›",
 *              full-width column.
 * - "columns"  ≥ 600 dp (landscape, tablet): columns side by side, free
 *              horizontal scrolling, no column bar.
 *
 * Status changes: long press on a card opens the status sheet
 * (`issue/[id]/picker/board-status`); TalkBack gets "move to next /
 * previous column" actions. Both go through `/move` with an Undo toast.
 *
 * Drag & drop ("columns" layout only): hold a card, drag it onto
 * another column, release → same `/move` + Undo toast. Holding without
 * dragging still opens the status sheet. See use-board-drag.tsx.
 *
 * Works on the list the screen already loaded (up to 10 pages of 100).
 * When the server has more, the board says so and shows counts
 * as "n+" (per-column paging via /api/issues/grouped: wave 2).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  FlatList,
  Pressable,
  ScrollView,
  View,
  useWindowDimensions,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import type { Issue } from "@multica/core/types";
import { Ionicons } from "@/components/ui/ionicons";
import { StatusIcon } from "@/components/ui/status-icon";
import { Text } from "@/components/ui/text";
import { BoardCard } from "@/components/issue/board/board-card";
import { router } from "expo-router";
import {
  boardColumns,
  boardIsEmpty,
  boardLayout,
  boardNotices,
  countLabel,
  hiddenIssueCount,
  isTruncated,
  neighborStatus,
  stepColumn,
  SELECTOR_FONT_SCALE,
  type BoardColumn,
} from "@/lib/board";
import { useBoardStatusChange } from "@/data/mutations/board-status";
import { useBoardDrag } from "@/components/issue/board/use-board-drag";
import type { GestureType } from "react-native-gesture-handler";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useIssueStatuses } from "@/lib/use-issue-statuses";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

interface Props {
  issues: Issue[];
  /** Issues the screen loaded before its own filters (truncation check). */
  loadedCount: number;
  /** Server total of the loaded list (data/queries/list-total.ts). */
  total?: number;
  /** A list filter is active: its chips carry the 100-issue hint. */
  filtersActive?: boolean;
  /** Active status filter: shows exactly these columns, hidden ones too. */
  statusFilters?: readonly string[];
  onOpenIssue: (issue: Issue) => void;
  /** Fixed height when the board sits inside a vertical ScrollView. */
  height?: number;
  /** Overrides the window width (e.g. a padded container). */
  width?: number;
}

export function IssueBoard({
  issues,
  loadedCount,
  total,
  filtersActive = false,
  statusFilters = [],
  onOpenIssue,
  height,
  width: widthProp,
}: Props) {
  const window = useWindowDimensions();
  const width = widthProp ?? window.width;
  const catalog = useIssueStatuses();
  const { t } = useT("issues");
  const columns = useMemo(
    () => boardColumns(issues, catalog.statuses, { statusFilters }),
    [issues, catalog.statuses, statusFilters],
  );
  const truncated = isTruncated(loadedCount, total);
  const hiddenCount = hiddenIssueCount(issues, { statusFilters });
  const show = boardNotices({ truncated, filtersActive, hiddenCount });
  // Inside a vertically scrolling page (project) a virtualized column would
  // nest a VirtualizedList in a ScrollView of the same direction.
  const embedded = height !== undefined;
  const layout = boardLayout(width, window.fontScale);
  const largeFont = window.fontScale >= SELECTOR_FONT_SCALE;
  const [active, setActive] = useState(0);
  const [boardHeight, setBoardHeight] = useState(0);
  const index = stepColumn(active, 0, columns.length);
  const pager = useRef<FlatList<BoardColumn>>(null);
  const wsSlug = useWorkspaceStore((s) => s.currentWorkspaceSlug);
  const change = useBoardStatusChange((label) => t("board.moved_to", { status: label }));

  const actions: CardActions = {
    openStatus: (issue) => {
      if (!wsSlug) return;
      router.push({
        pathname: "/[workspace]/issue/[id]/picker/board-status",
        params: { workspace: wsSlug, id: issue.id, status: issue.status },
      });
    },
    neighbor: (issue, delta) => neighborStatus(columns, issue.status, delta),
    move: (issue, delta) => {
      const to = neighborStatus(columns, issue.status, delta);
      if (to) void change(issue.id, issue.status, to, catalog.labelOf(to));
    },
  };

  // Drag & drop only with several columns side by side (kanban.md).
  // Matches contentContainerClassName "gap-3 px-3" of the columns view.
  const dnd = useBoardDrag({
    enabled: layout.mode === "columns",
    columns,
    columnWidth: layout.columnWidth,
    paddingLeft: 12,
    gap: 12,
    onMove: (issue, to) => void change(issue.id, issue.status, to, catalog.labelOf(to)),
    onMenu: (issue) => actions.openStatus(issue),
  });
  actions.drag =
    layout.mode === "columns"
      ? { gestureFor: dnd.gestureFor, guardPress: dnd.guardPress, draggingId: dnd.drag?.issue.id ?? null }
      : undefined;

  const renderColumn = (column: BoardColumn, w: number) => (
    <ColumnView
      column={column}
      width={w}
      largeFont={largeFont}
      onOpenIssue={onOpenIssue}
      embedded={embedded}
      actions={actions}
    />
  );

  if (columns.length === 0) return null;

  const notices = (
    <>
      {show.truncated ? (
        <Text className="px-4 pt-1 text-xs text-amber-600 dark:text-amber-400" testID="board-truncated">
          {t("board.truncated_hint", { count: loadedCount })}
        </Text>
      ) : null}
      {show.hidden ? (
        <Text className="px-4 pt-1 text-xs text-muted-foreground" testID="board-hidden">
          {t("board.hidden_hint", { status: catalog.labelOf("cancelled"), count: hiddenCount })}
        </Text>
      ) : null}
    </>
  );

  // Every match sits in a hidden column (Cancelled): an empty state with
  // the hidden notice instead of empty columns.
  if (boardIsEmpty(columns)) {
    return (
      <View style={height ? { height } : undefined} testID="board-empty">
        {notices}
        <Text className="px-4 py-6 text-sm text-muted-foreground">{t("board.empty")}</Text>
      </View>
    );
  }

  if (layout.mode === "columns") {
    // Columns get the measured height so each list scrolls on its own.
    const hover = dnd.drag?.hover ?? null;
    const dragFrom = dnd.drag?.issue.status ?? null;
    return (
      <View style={height ? { height } : { flex: 1 }} ref={dnd.containerRef}>
      {notices}
      <ScrollView
        {...dnd.scrollProps}
        horizontal
        style={{ flex: 1 }}
        onLayout={(e) => setBoardHeight(e.nativeEvent.layout.height)}
        contentContainerClassName="gap-3 px-3 py-2"
        testID="issue-board"
      >
        {columns.map((c) => {
          const isTarget = hover === c.status && hover !== dragFrom;
          return (
            <View
              key={c.status}
              style={{ width: layout.columnWidth, height: boardHeight ? boardHeight - 16 : undefined }}
              className={cn("rounded-lg border-2", isTarget ? "border-primary bg-accent/40" : "border-transparent")}
              testID={isTarget ? "board-drop-target" : undefined}
            >
              <ColumnHeader column={c} truncated={truncated} />
              {renderColumn(c, layout.columnWidth - 4)}
            </View>
          );
        })}
      </ScrollView>
      {dnd.overlay}
      </View>
    );
  }

  if (layout.mode === "selector") {
    const column = columns[index]!;
    return (
      <View style={height ? { height } : { flex: 1 }} testID="issue-board">
        {notices}
        <SelectorRow
          column={column}
          truncated={truncated}
          canPrev={index > 0}
          canNext={index < columns.length - 1}
          onStep={(d) => setActive(stepColumn(index, d, columns.length))}
        />
        {renderColumn(column, layout.columnWidth)}
      </View>
    );
  }

  const goTo = (i: number) => {
    setActive(i);
    pager.current?.scrollToOffset({ offset: i * layout.columnWidth, animated: true });
  };
  const onSettle = (e: NativeSyntheticEvent<NativeScrollEvent>) =>
    setActive(stepColumn(Math.round(e.nativeEvent.contentOffset.x / layout.columnWidth), 0, columns.length));

  return (
    <View style={height ? { height } : { flex: 1 }} testID="issue-board">
      {notices}
      <ColumnBar columns={columns} active={index} onSelect={goTo} truncated={truncated} />
      <FlatList
        ref={pager}
        // Remount on a new column width (rotation, font size) and keep the
        // column the bar shows.
        key={`pager-${layout.columnWidth}`}
        initialScrollIndex={index}
        horizontal
        data={columns}
        keyExtractor={(c) => c.status}
        showsHorizontalScrollIndicator={false}
        snapToInterval={layout.columnWidth}
        decelerationRate="fast"
        disableIntervalMomentum
        onMomentumScrollEnd={onSettle}
        getItemLayout={(_, i) => ({ length: layout.columnWidth, offset: layout.columnWidth * i, index: i })}
        renderItem={({ item }) => renderColumn(item, layout.columnWidth)}
      />
    </View>
  );
}

interface CardActions {
  openStatus: (issue: Issue) => void;
  neighbor: (issue: Issue, delta: -1 | 1) => string | null;
  move: (issue: Issue, delta: -1 | 1) => void;
  /** Drag & drop, "columns" layout only. */
  drag?: {
    gestureFor: (issue: Issue) => GestureType | undefined;
    guardPress: (fn: () => void) => () => void;
    draggingId: string | null;
  };
}

function ColumnView({
  column,
  width,
  largeFont,
  onOpenIssue,
  embedded,
  actions,
}: {
  column: BoardColumn;
  width: number;
  largeFont: boolean;
  onOpenIssue: (issue: Issue) => void;
  embedded: boolean;
  actions: CardActions;
}) {
  const { t } = useT("issues");
  const press = (item: Issue) => {
    const open = () => onOpenIssue(item);
    return actions.drag ? actions.drag.guardPress(open) : open;
  };
  if (embedded) {
    return (
      <ScrollView style={{ width, flex: 1 }} nestedScrollEnabled contentContainerClassName="gap-2 px-2 pt-2 pb-6">
        {column.issues.length === 0 ? (
          <Text className="px-2 py-6 text-center text-sm text-muted-foreground">{t("board.empty_column")}</Text>
        ) : (
          column.issues.map((item) => (
            <BoardCard
              key={item.id}
              issue={item}
              largeFont={largeFont}
              onPress={press(item)}
              dragGesture={actions.drag?.gestureFor(item)}
              dragging={actions.drag?.draggingId === item.id}
              onLongPress={() => actions.openStatus(item)}
              onMove={(delta) => actions.move(item, delta)}
              canMovePrev={actions.neighbor(item, -1) !== null}
              canMoveNext={actions.neighbor(item, 1) !== null}
            />
          ))
        )}
      </ScrollView>
    );
  }
  return (
    <FlatList
      style={{ width, flex: 1 }}
      data={column.issues}
      keyExtractor={(i) => i.id}
      // Re-render cards when a drag starts/ends (dimmed card, press guard).
      extraData={actions.drag?.draggingId}
      contentContainerClassName="gap-2 px-2 pt-2 pb-6"
      nestedScrollEnabled
      renderItem={({ item }) => (
        <BoardCard
          issue={item}
          largeFont={largeFont}
          onPress={press(item)}
          dragGesture={actions.drag?.gestureFor(item)}
          dragging={actions.drag?.draggingId === item.id}
          onLongPress={() => actions.openStatus(item)}
          onMove={(delta) => actions.move(item, delta)}
          canMovePrev={actions.neighbor(item, -1) !== null}
          canMoveNext={actions.neighbor(item, 1) !== null}
        />
      )}
      ListEmptyComponent={
        <Text className="px-2 py-6 text-center text-sm text-muted-foreground">{t("board.empty_column")}</Text>
      }
    />
  );
}

function ColumnHeader({ column, truncated }: { column: BoardColumn; truncated: boolean }) {
  const catalog = useIssueStatuses();
  return (
    <View className="flex-row flex-wrap items-center gap-2 px-2 py-2" accessibilityRole="header">
      <StatusIcon status={column.status} category={catalog.categoryOf(column.status)} icon={catalog.iconOf(column.status)} color={catalog.colorOf(column.status)} size={14} />
      <Text className="text-sm font-medium text-foreground">{catalog.labelOf(column.status)}</Text>
      <Text className="text-sm text-muted-foreground">{countLabel(column.issues.length, truncated)}</Text>
    </View>
  );
}

function ColumnBar({
  columns,
  active,
  onSelect,
  truncated,
}: {
  columns: BoardColumn[];
  active: number;
  onSelect: (index: number) => void;
  truncated: boolean;
}) {
  const catalog = useIssueStatuses();
  const bar = useRef<ScrollView>(null);
  const offsets = useRef<number[]>([]);
  // Keep the active chip in view while the pager is swiped.
  useEffect(() => {
    bar.current?.scrollTo({ x: Math.max(0, (offsets.current[active] ?? 0) - 16), animated: true });
  }, [active]);
  return (
    <ScrollView
      ref={bar}
      horizontal
      showsHorizontalScrollIndicator={false}
      className="grow-0 border-b border-border"
      contentContainerClassName="gap-1.5 px-3 py-2"
      accessibilityRole="tablist"
      testID="board-column-bar"
    >
      {columns.map((c, i) => {
        const selected = i === active;
        const label = catalog.labelOf(c.status);
        return (
          <Pressable
            key={c.status}
            onLayout={(e) => (offsets.current[i] = e.nativeEvent.layout.x)}
            onPress={() => onSelect(i)}
            // 36 dp chip + 6 dp slop = 48 dp touch target.
            hitSlop={6}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={`${label}, ${countLabel(c.issues.length, truncated)}`}
            className={cn(
              "min-h-9 flex-row items-center gap-1.5 rounded-full border px-3",
              selected ? "border-foreground/40 bg-accent" : "border-border",
              c.issues.length === 0 && !selected && "opacity-60",
            )}
          >
            <StatusIcon status={c.status} category={catalog.categoryOf(c.status)} icon={catalog.iconOf(c.status)} color={catalog.colorOf(c.status)} size={12} />
            <Text className={cn("text-sm", selected ? "text-accent-foreground" : "text-muted-foreground")}>
              {label} · {countLabel(c.issues.length, truncated)}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

function SelectorRow({
  column,
  truncated,
  canPrev,
  canNext,
  onStep,
}: {
  column: BoardColumn;
  truncated: boolean;
  canPrev: boolean;
  canNext: boolean;
  onStep: (delta: number) => void;
}) {
  const { t } = useT("issues");
  const catalog = useIssueStatuses();
  const { colorScheme } = useColorScheme();
  const color = THEME[colorScheme].foreground;
  const arrow = (delta: number, enabled: boolean) => (
    <Pressable
      onPress={() => onStep(delta)}
      disabled={!enabled}
      accessibilityRole="button"
      accessibilityLabel={t(delta < 0 ? "board.prev_column" : "board.next_column")}
      accessibilityState={{ disabled: !enabled }}
      testID={delta < 0 ? "board-prev-column" : "board-next-column"}
      className={cn("h-12 w-12 items-center justify-center", !enabled && "opacity-30")}
    >
      <Ionicons name={delta < 0 ? "chevron-back" : "chevron-forward"} size={22} color={color} />
    </Pressable>
  );
  return (
    <View className="flex-row items-center border-b border-border px-1">
      {arrow(-1, canPrev)}
      <Text
        className="flex-1 text-center text-base font-medium text-foreground"
        accessibilityRole="header"
        testID="board-selector-label"
      >
        {catalog.labelOf(column.status)} · {countLabel(column.issues.length, truncated)}
      </Text>
      {arrow(1, canNext)}
    </View>
  );
}
