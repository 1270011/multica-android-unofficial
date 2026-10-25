/**
 * Workspace-level mention picker route — formSheet, opened from any
 * composer that has an `@` button (currently the issue-comment composer
 * and the chat composer).
 *
 * `?mode=` controls which sections render:
 *   - "comment" (default) — @all + People + Agents + Squads + Issues.
 *     The comment composer offers the full surface; mentions notify the
 *     mentioned actor.
 *   - "chat" — Issues only. Chat is user ↔ single agent, so member /
 *     agent / squad / @all mentions are noise (and would generate
 *     unintended notifications). Issues remain useful as "reference this
 *     ticket for the agent's context".
 *
 * Lives at workspace level (not nested under issue/[id]) because the chat
 * tab has no per-session route to nest under; making it workspace-level
 * keeps a single route file serving both contexts.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Platform, TextInput, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { MentionPickerBody } from "@/components/issue/pickers/mention-picker-body";
import { useMentionDraftStore } from "@/data/stores/mention-draft-store";
import { MOBILE_PLACEHOLDER_COLOR } from "@/components/ui/input-tokens";
import { mentionSearchInBody } from "@/lib/mention-picker-selection";
import { useClearableNativeSearchBar } from "@/lib/use-native-search-bar";
import { useT } from "@/lib/i18n";

type Mode = "comment" | "chat";

export default function MentionPickerRoute() {
  const { mode: rawMode } = useLocalSearchParams<{ mode?: string }>();
  const { t } = useT("issues");
  const mode: Mode = rawMode === "chat" ? "chat" : "comment";
  const placeholder =
    mode === "chat"
      ? t("picker.reference_issue")
      : t("picker.search_people_issues");
  // Tells the composer that opened the sheet to take the focus back
  // (F1); every way of closing unmounts the route.
  useEffect(
    () => () => useMentionDraftStore.getState().markPickerClosed(),
    [],
  );
  return mentionSearchInBody(Platform.OS) ? (
    <BodySearchPicker mode={mode} placeholder={placeholder} />
  ) : (
    <NativeSearchPicker mode={mode} placeholder={placeholder} />
  );
}

/** iOS: search field in the native sheet header (UISearchController). */
function NativeSearchPicker({
  mode,
  placeholder,
}: {
  mode: Mode;
  placeholder: string;
}) {
  const { query, clearQuery } = useClearableNativeSearchBar(placeholder, {
    autoFocus: true,
  });
  return (
    <MentionPickerBody mode={mode} query={query} onClearQuery={clearQuery} />
  );
}

/**
 * Android: the formSheet renders no header there, so the
 * native search bar never appears. A plain TextInput in the body takes
 * its place. `clear()` empties it after a pick (W3-P3) without touching
 * focus, so the keyboard stays up for the next name.
 */
function BodySearchPicker({
  mode,
  placeholder,
}: {
  mode: Mode;
  placeholder: string;
}) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<TextInput>(null);
  const clearQuery = useCallback(() => {
    inputRef.current?.clear();
    setQuery("");
  }, []);
  return (
    <MentionPickerBody
      mode={mode}
      query={query}
      onClearQuery={clearQuery}
      searchField={
        <View className="px-4 pt-3 pb-2">
          <TextInput
            ref={inputRef}
            testID="mention-picker-search"
            onChangeText={setQuery}
            placeholder={placeholder}
            placeholderTextColor={MOBILE_PLACEHOLDER_COLOR}
            autoFocus
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            accessibilityLabel={placeholder}
            style={{ fontSize: 16, includeFontPadding: false }}
            className="rounded-md px-3 min-h-12 text-foreground bg-secondary/50"
          />
        </View>
      }
    />
  );
}
