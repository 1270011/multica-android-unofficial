/**
 * Board card: identifier and priority,
 * title (3 lines, 4 at large font), assignee and due date (red when
 * overdue). The whole card opens the issue. Font scaling stays on; the
 * card grows instead of cutting text.
 *
 * Drag & drop: with `dragGesture` (columns layout only) the long
 * press lifts the card instead of opening the menu directly; the board
 * opens the menu when the lifted card is released without moving.
 *
 * Selection mode: while `selected` is a boolean a checkbox
 * leads the card, TalkBack reads it as a checkbox, `onPress` is expected to
 * toggle, and the long press and column moves are off (the board passes no
 * drag gesture then).
 */
import { Pressable, View } from "react-native";
import { Ionicons } from "@/components/ui/ionicons";
import { GestureDetector, type GestureType } from "react-native-gesture-handler";
import type { Issue } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { ActorAvatar } from "@/components/ui/actor-avatar";
import { PriorityIcon } from "@/components/ui/priority-icon";
import { CustomStatusChip } from "@/components/issue/custom-status-chip";
import { isOverdue } from "@/lib/board";
import { PRIORITY_LABEL } from "@/lib/issue-status";
import { useIssueStatuses } from "@/lib/use-issue-statuses";
import { useT } from "@/lib/i18n";
import { useActorLookup } from "@/data/use-actor-name";
import { cn } from "@/lib/utils";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";

export function BoardCard({
  issue,
  onPress,
  onLongPress,
  onMove,
  canMovePrev,
  canMoveNext,
  largeFont,
  dragGesture,
  dragging = false,
  selected,
}: {
  issue: Issue;
  onPress: () => void;
  /** Opens the status sheet. */
  onLongPress: () => void;
  /** Moves the card one column left (-1) or right (+1). */
  onMove: (delta: -1 | 1) => void;
  canMovePrev: boolean;
  canMoveNext: boolean;
  largeFont: boolean;
  /** Board drag gesture (columns layout); replaces the touch long press. */
  dragGesture?: GestureType;
  /** This card is lifted; the board shows a floating copy. */
  dragging?: boolean;
  /** Selection mode: checked state of the card's checkbox. */
  selected?: boolean;
}) {
  const { t } = useT("issues");
  const catalog = useIssueStatuses();
  const { getName } = useActorLookup();
  const { colorScheme } = useColorScheme();
  const selecting = selected !== undefined;
  const overdue = isOverdue(issue.due_date);
  const due = issue.due_date?.slice(0, 10);
  const dueText = due ? (overdue ? t("board.overdue", { date: due }) : t("board.due", { date: due })) : null;
  const assignee =
    issue.assignee_type && issue.assignee_id ? getName(issue.assignee_type, issue.assignee_id) : null;
  const card = (
    <Pressable
      onPress={onPress}
      // With a drag gesture the board handles the long press (lift, or the
      // menu on release); TalkBack's "longpress" action below stays.
      onLongPress={dragGesture || selecting ? undefined : onLongPress}
      delayLongPress={400}
      // TalkBack: no swipe gestures on cards (they would fight the pager),
      // so the column moves are custom actions.
      accessibilityActions={
        selecting
          ? undefined
          : [
              { name: "longpress", label: t("board.change_status") },
              ...(canMoveNext ? [{ name: "next_column", label: t("board.move_next") }] : []),
              ...(canMovePrev ? [{ name: "prev_column", label: t("board.move_prev") }] : []),
            ]
      }
      onAccessibilityAction={(e) => {
        if (selecting) return;
        if (e.nativeEvent.actionName === "longpress") onLongPress();
        else if (e.nativeEvent.actionName === "next_column") onMove(1);
        else if (e.nativeEvent.actionName === "prev_column") onMove(-1);
      }}
      accessibilityRole={selecting ? "checkbox" : "button"}
      accessibilityState={selecting ? { checked: selected } : undefined}
      // Spec: identifier, title, status, priority, assignee (+ due date).
      accessibilityLabel={[
        issue.identifier,
        issue.title,
        catalog.labelOf(issue.status),
        t(PRIORITY_LABEL[issue.priority]),
        assignee,
        dueText,
      ]
        .filter(Boolean)
        .join(", ")}
      testID={`board-card-${issue.identifier}`}
      className={cn(
        "min-h-[72px] gap-1.5 rounded-lg border border-border bg-card px-3 py-2.5 active:bg-secondary",
        dragging && "opacity-40",
        selected && "border-primary bg-accent",
      )}
    >
      <View className="flex-row flex-wrap items-center gap-2">
        {selecting ? (
          <Ionicons
            name={selected ? "checkbox" : "square-outline"}
            size={24}
            color={selected ? THEME[colorScheme].primary : THEME[colorScheme].mutedForeground}
          />
        ) : null}
        <PriorityIcon priority={issue.priority} size={14} />
        <Text className="text-xs text-muted-foreground">{issue.identifier}</Text>
        <CustomStatusChip status={issue.status} catalog={catalog} />
      </View>
      <Text className="text-sm text-foreground" numberOfLines={largeFont ? 4 : 3}>
        {issue.title}
      </Text>
      {due || (issue.assignee_type && issue.assignee_id) ? (
        <View className="flex-row flex-wrap items-center gap-2">
          {issue.assignee_type && issue.assignee_id ? (
            <ActorAvatar type={issue.assignee_type} id={issue.assignee_id} size={18} />
          ) : null}
          {due ? (
            <Text className={cn("text-xs", overdue ? "text-destructive" : "text-muted-foreground")}>
              {dueText}
            </Text>
          ) : null}
        </View>
      ) : null}
    </Pressable>
  );
  return dragGesture ? <GestureDetector gesture={dragGesture}>{card}</GestureDetector> : card;
}
