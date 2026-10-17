/**
 * Text in the native stack header (title, text buttons) scales with the
 * system font only up to this factor (smoke test: at 200 % the
 * titles of every stack screen ran into the status bar). The bar keeps its
 * height; screen readers still get the full text. Same idea as the tab
 * labels (TAB_LABEL_MAX_FONT_SCALE) and iOS' navigation bar.
 */
export const HEADER_MAX_FONT_SCALE = 1.3;

/** Gap between a modal's ✕ (headerLeft) and the Android title. */
export const MODAL_CLOSE_TITLE_GAP_DP = 12;
