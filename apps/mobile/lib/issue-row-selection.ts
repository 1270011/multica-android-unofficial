/**
 * Press wiring of `IssueRow` for multi-select.
 *
 * `onLongPress` must stay defined after the long press has started the
 * selection: RN's Pressability reads the handlers of the latest render on
 * release and fires `onPress` too when `onLongPress` is null by then. The
 * row's `onPress` toggles in selection mode, so the freshly selected row
 * was deselected again and the bar showed "0 selected".
 * Inside selection mode a long press toggles the row like a tap.
 */
export interface IssueRowSelectionInput {
  /** Tap handler; toggles the row while selecting. */
  onPress: () => void;
  /** Start the selection with this row; absent = no multi-select. */
  onSelect?: () => void;
  /** Checked state; `undefined` = not in selection mode. */
  selected?: boolean;
  /** TalkBack label of the "select" action. */
  selectLabel: string;
}

export interface IssueRowSelectionProps {
  onLongPress?: () => void;
  accessibilityRole?: "checkbox";
  accessibilityState?: { checked: boolean };
  accessibilityActions?: { name: string; label: string }[];
  onAccessibilityAction: (e: { nativeEvent: { actionName: string } }) => void;
}

export function issueRowSelectionProps({
  onPress,
  onSelect,
  selected,
  selectLabel,
}: IssueRowSelectionInput): IssueRowSelectionProps {
  const selecting = selected !== undefined;
  const canStartSelection = !!onSelect && !selecting;
  return {
    onLongPress: onSelect ? (selecting ? onPress : onSelect) : undefined,
    accessibilityRole: selecting ? "checkbox" : undefined,
    accessibilityState: selecting ? { checked: selected } : undefined,
    accessibilityActions: canStartSelection
      ? [{ name: "select", label: selectLabel }]
      : undefined,
    onAccessibilityAction: (e) => {
      if (e.nativeEvent.actionName === "select" && canStartSelection) onSelect();
    },
  };
}
