/**
 * Space the issue chat list leaves for the keyboard. The composer
 * lifts with `KeyboardStickyView` (offset `opened: insets.bottom`), a
 * translation that does not resize anything, so the list kept its height
 * and the keyboard covered its last rows. With this as the list's bottom
 * padding the list gets shorter instead, and its scroll view keeps the end
 * in view (`endOffsetAfterShrink`).
 */
export function chatKeyboardInset(visible: boolean, height: number, bottomInset: number): number {
  if (!visible || height <= 0) return 0;
  return Math.max(0, Math.round(height - bottomInset));
}
