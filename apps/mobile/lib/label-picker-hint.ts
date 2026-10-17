/**
 * Empty-state hint of the label picker.
 *
 * The search field comes from the native header search bar
 * (`useNativeSearchBar`), which only iOS shows on the picker sheet. On
 * Android there is no field, so there is also no "type a name to create" —
 * the hint must not point at it. Where search exists, the hint is shown
 * for "no labels yet" and for "no matches" alike.
 */
export type LabelPickerHintKey = "picker.no_labels_hint" | "picker.no_labels_hint_web";

export function labelPickerHintKey(hasSearch: boolean, query: string): LabelPickerHintKey {
  if (hasSearch && query.trim() === "") return "picker.no_labels_hint";
  return "picker.no_labels_hint_web";
}

/** The picker's search bar exists only where the native header shows it. */
export function labelPickerHasSearch(os: string): boolean {
  return os === "ios";
}
