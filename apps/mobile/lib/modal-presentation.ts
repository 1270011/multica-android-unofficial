/**
 * Presentation of the full-screen "modal" routes (search, new/edit issue,
 * new/edit project). On Android react-native-screens draws a
 * `presentation: "modal"` header without the status bar inset under
 * edge-to-edge: the ✕ sat on the clock, at 100 % font too (smoke test
 * s4/s5). A card that slides up from the bottom looks the same and gets
 * the inset like every other stack screen. iOS keeps its native modal.
 */
export type ModalPresentation =
  | { presentation: "modal" }
  | { presentation: "card"; animation: "slide_from_bottom" };

export function modalPresentation(os: string): ModalPresentation {
  return os === "ios"
    ? { presentation: "modal" }
    : { presentation: "card", animation: "slide_from_bottom" };
}
