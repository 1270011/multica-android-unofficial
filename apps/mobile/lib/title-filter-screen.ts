/**
 * View model of Settings › View › Hide issues, kept out of
 * the screen so the rules can be unit-tested:
 *   - nothing is editable until the workspace's stored values are loaded
 *     (`useViewPrefsHydrated`): a change replaces the whole stored value,
 *     so an early tap would overwrite the saved pattern with the default
 *   - field error and preview follow the saved pattern; while typing, the
 *     last saved pattern stays in force until the 400 ms debounce saves
 *   - "Also mute push notifications" (W7) is usable only while the filter
 *     is on and the saved pattern valid; its stored value is kept otherwise
 */
import { patternState, type TitlePatternError, titleFilterPreview } from "./title-filter";
import type { TitleFilterSettings } from "./view-prefs";
import { titleMuteAvailable } from "./notify/title-mute";

export const TITLE_FILTER_SAVE_DEBOUNCE_MS = 400;

export interface TitleFilterScreenView {
  /** Switches and field disabled (stored values not loaded yet). */
  locked: boolean;
  /** Error shown under the field (red frame), also with the switch off. */
  error: TitlePatternError | null;
  /** "Matches x of y loaded issues"; `null` without a usable pattern. */
  preview: { hidden: number; total: number } | null;
  /** No loaded issues to preview against. */
  previewEmpty: boolean;
  /** Push mute switch can be used (filter on, pattern valid, hydrated). */
  muteAvailable: boolean;
}

export function titleFilterScreenView(input: {
  hydrated: boolean;
  settings: TitleFilterSettings;
  loadedTitles: readonly string[];
}): TitleFilterScreenView {
  const { hydrated, settings, loadedTitles } = input;
  if (!hydrated) {
    return { locked: true, error: null, preview: null, previewEmpty: false, muteAvailable: false };
  }
  const state = patternState(settings);
  const error = state.status === "error" ? state.error : null;
  const preview =
    state.status === "active" && loadedTitles.length > 0
      ? titleFilterPreview(settings, loadedTitles)
      : null;
  return {
    locked: false,
    error,
    preview,
    previewEmpty: state.status === "active" && loadedTitles.length === 0,
    muteAvailable: titleMuteAvailable(settings),
  };
}

/** i18n key + params of the field error (settings namespace). */
export function titleFilterErrorText(error: TitlePatternError): {
  key: string;
  params?: Record<string, string>;
} {
  switch (error.kind) {
    case "invalid":
      return { key: "title_filter.invalid", params: { message: error.message } };
    case "too_long":
      return { key: "title_filter.too_long" };
    case "too_complex":
      return { key: "title_filter.too_complex" };
    case "too_slow":
      return { key: "title_filter.too_slow" };
  }
}
