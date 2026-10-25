/**
 * Hook for wiring an iOS native `UISearchController` (via react-native-screens
 * `headerSearchBarOptions`) into a route. Returns the current query string.
 *
 * Used by every search-enabled picker route on mobile (issue/project/label/
 * lead). Pair with `useScrollToTopOnChange` in the body to reset the list
 * scroll position when the filter changes.
 *
 * Why this exists rather than inlining `setOptions` in every route:
 *   - Cancel button contract: `cancelSearch()` clears the native text but
 *     does NOT fire `onChangeText`, so the route MUST reset query state in
 *     `onCancelButtonPress`. Easy to forget when copy-pasted.
 *   - Sensible defaults (autoCapitalize: "none", hideWhenScrolling: false)
 *     match the standard iOS picker pattern; one place to revise.
 *
 * Requires the Stack.Screen to register `headerShown: true` + a `title` in
 * the layout. See `apps/mobile/app/(app)/[workspace]/_layout.tsx` for the
 * pattern.
 */
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { useNavigation } from "expo-router";
import type { NativeSyntheticEvent, TextInputFocusEventData } from "react-native";
import type { SearchBarCommands } from "react-native-screens";

export function useNativeSearchBar(
  placeholder: string,
  options?: { autoFocus?: boolean },
): string {
  return useClearableNativeSearchBar(placeholder, options).query;
}

/**
 * Same as `useNativeSearchBar`, plus `clearQuery()` that empties the field
 * while keeping focus and keyboard (W3-P3: the @-sheet
 * clears the search after a pick so the next name can be typed at once).
 *
 * `clearText()` goes through the native ref. On Android it is
 * `SearchView.setQuery("", false)`: only the text changes, focus stays in
 * the EditText, so the keyboard stays up. iOS does not fire `onChangeText`
 * for it, hence the explicit `setQuery("")` (harmless on Android, where
 * the native change event delivers the same empty string).
 */
export function useClearableNativeSearchBar(
  placeholder: string,
  options?: { autoFocus?: boolean },
): { query: string; clearQuery: () => void } {
  const navigation = useNavigation();
  const [query, setQuery] = useState("");
  const searchBarRef = useRef<SearchBarCommands>(null);
  const autoFocus = options?.autoFocus;

  useLayoutEffect(() => {
    navigation.setOptions({
      headerSearchBarOptions: {
        placeholder,
        autoCapitalize: "none",
        hideWhenScrolling: false,
        // Opt-in: pickers whose primary action is typing (assignee, label,
        // project, lead) set this so the keyboard appears on mount. Apple
        // HIG cautions against auto-keyboard for browse-first lists; pass
        // `autoFocus: true` only when the picker is search-first.
        autoFocus,
        ref: searchBarRef,
        onChangeText: (e: NativeSyntheticEvent<TextInputFocusEventData>) =>
          setQuery(e.nativeEvent.text),
        onCancelButtonPress: () => setQuery(""),
      },
    });
  }, [navigation, placeholder, autoFocus]);

  const clearQuery = useCallback(() => {
    searchBarRef.current?.clearText();
    setQuery("");
  }, []);

  return { query, clearQuery };
}
