import { describe, expect, it } from "vitest";
import { issueRowSelectionProps } from "./issue-row-selection";

/**
 * Minimal list screen like (tabs)/my-issues: `selected` is undefined until
 * the selection starts, then the row's checked state; a tap toggles while
 * selecting. `render()` returns the row's props of the current state.
 */
function screen(rowId = "a") {
  let selection: Set<string> | null = null;
  let opened = 0;
  const render = () => {
    const onPress = () => {
      if (selection) {
        if (selection.has(rowId)) selection.delete(rowId);
        else selection.add(rowId);
      } else opened += 1;
    };
    return {
      onPress,
      ...issueRowSelectionProps({
        onPress,
        onSelect: () => {
          selection = new Set([rowId]);
        },
        selected: selection ? selection.has(rowId) : undefined,
        selectLabel: "Select",
      }),
    };
  };
  return {
    render,
    selectedCount: () => selection?.size ?? 0,
    selecting: () => selection !== null,
    opened: () => opened,
  };
}

/**
 * RN Pressability (Libraries/Pressability/Pressability.js, release): the
 * long press fires with the props of the render it started in; on release
 * the props of the latest render apply and `onPress` is skipped only when
 * `onLongPress` is still non-null.
 */
function longPressAndRelease(s: ReturnType<typeof screen>) {
  s.render().onLongPress?.();
  const afterLongPress = s.render();
  if (afterLongPress.onLongPress == null) afterLongPress.onPress();
}

describe("issueRowSelectionProps", () => {
  it("long press selects exactly the pressed row and release keeps it", () => {
    const s = screen();
    longPressAndRelease(s);
    expect(s.selecting()).toBe(true);
    expect(s.selectedCount()).toBe(1);
    expect(s.render().accessibilityState).toEqual({ checked: true });
    expect(s.opened()).toBe(0);
  });

  it("long press inside selection mode toggles like a tap", () => {
    const s = screen();
    longPressAndRelease(s);
    longPressAndRelease(s);
    expect(s.selectedCount()).toBe(0);
    longPressAndRelease(s);
    expect(s.selectedCount()).toBe(1);
  });

  it("TalkBack action 'select' starts the selection with the row", () => {
    const s = screen();
    const props = s.render();
    expect(props.accessibilityActions).toEqual([{ name: "select", label: "Select" }]);
    props.onAccessibilityAction({ nativeEvent: { actionName: "select" } });
    expect(s.selectedCount()).toBe(1);
    const selecting = s.render();
    expect(selecting.accessibilityRole).toBe("checkbox");
    // No second "select" action while the selection is running.
    expect(selecting.accessibilityActions).toBeUndefined();
  });

  it("ignores other TalkBack actions", () => {
    const s = screen();
    s.render().onAccessibilityAction({ nativeEvent: { actionName: "activate" } });
    expect(s.selecting()).toBe(false);
  });

  it("a tap outside selection mode opens the issue", () => {
    const s = screen();
    s.render().onPress();
    expect(s.opened()).toBe(1);
    expect(s.selecting()).toBe(false);
  });

  it("rows without onSelect get no long press and no select action", () => {
    const props = issueRowSelectionProps({ onPress: () => {}, selectLabel: "Select" });
    expect(props.onLongPress).toBeUndefined();
    expect(props.accessibilityActions).toBeUndefined();
    expect(props.accessibilityRole).toBeUndefined();
  });
});
