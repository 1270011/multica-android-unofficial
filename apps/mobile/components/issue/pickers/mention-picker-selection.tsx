/**
 * Selection bar + "Done (n)" button for the @-sheet
 * (W3-P2).
 *
 * The sheet is multi-select. Before this, the only feedback for an
 * earlier pick was its checkmark — scrolled out of view after a few
 * picks, so users scrolled back to check or undo. The bar sits fixed
 * under the search field and lists every pick as a chip; tapping a chip
 * removes it. It is absent while nothing is selected (no empty strip).
 *
 * "Done (n)" stays pinned at the bottom above the keyboard / nav bar and
 * closes the sheet. Back and drag-down still close it too and keep the
 * selection — there is no cancel path, nothing gets lost.
 */
import { useRef } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColorScheme } from "nativewind";
import { Ionicons } from "@/components/ui/ionicons";
import { Text } from "@/components/ui/text";
import type { MentionChipDraft } from "@/data/stores/mention-draft-store";
import {
  mentionChipLabel,
  mentionDoneLabel,
  mentionSpokenName,
} from "@/lib/mention-picker-selection";
import { THEME } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n";

/** Min touch height (dp) for chips, bar and button (A3.6). */
const TOUCH = 48;

export function MentionSelectionBar({
  selected,
  onRemove,
}: {
  selected: MentionChipDraft[];
  onRemove: (m: MentionChipDraft) => void;
}) {
  const { t } = useT("issues");
  const { colorScheme } = useColorScheme();
  const theme = colorScheme === "dark" ? THEME.dark : THEME.light;
  const scrollRef = useRef<ScrollView>(null);
  // Only follow the end when a chip was added, not when one was removed
  // (the user may be working through chips in the middle).
  const lastCount = useRef(selected.length);

  if (selected.length === 0) return null;

  return (
    <View
      testID="mention-selection-bar"
      className="flex-row items-center border-b border-border bg-background"
      style={{ minHeight: TOUCH }}
    >
      <ScrollView
        ref={scrollRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        className="flex-1"
        contentContainerStyle={{
          gap: 6,
          paddingHorizontal: 12,
          alignItems: "center",
        }}
        onContentSizeChange={() => {
          if (selected.length > lastCount.current) {
            scrollRef.current?.scrollToEnd({ animated: true });
          }
          lastCount.current = selected.length;
        }}
      >
        {selected.map((m) => (
          <Pressable
            key={`${m.type}:${m.id}`}
            testID={`mention-chip-${m.type}-${m.id}`}
            onPress={() => onRemove(m)}
            accessibilityRole="button"
            accessibilityLabel={t("picker.remove_chip_a11y", {
              name: mentionSpokenName(m),
            })}
            // The visible capsule stays compact; the pressable itself is
            // the full bar height so the target meets 48 dp.
            className="justify-center"
            style={{ minHeight: TOUCH }}
          >
            {/* Pressed state from the Pressable: a pressed-state class on the
                capsule makes NativeWind turn it into its own touch target,
                which swallowed the tap on Android. */}
            {({ pressed }) => (
              <View
                className={cn(
                  "flex-row items-center gap-1 h-8 pl-3 pr-2 rounded-full",
                  pressed ? "bg-primary/20" : "bg-primary/10",
                )}
              >
                <Text
                  className="text-sm font-medium text-foreground"
                  numberOfLines={1}
                >
                  {mentionChipLabel(m)}
                </Text>
                <Ionicons
                  name="close"
                  size={16}
                  color={theme.mutedForeground}
                />
              </View>
            )}
          </Pressable>
        ))}
      </ScrollView>
      <Text
        className="pr-4 pl-2 text-sm text-muted-foreground"
        numberOfLines={1}
        // The count is part of every toggle announcement already.
        importantForAccessibility="no"
      >
        {t("picker.selected_count", { count: selected.length })}
      </Text>
    </View>
  );
}

export function MentionDoneBar({
  count,
  keyboardOpen,
  onDone,
}: {
  count: number;
  /** Nav-bar inset is only needed while the keyboard is closed; with the
   *  keyboard open the bar sits directly on top of it. */
  keyboardOpen: boolean;
  onDone: () => void;
}) {
  const { t } = useT("issues");
  const insets = useSafeAreaInsets();
  return (
    <View
      className="border-t border-border bg-background px-4 pt-2"
      style={{ paddingBottom: (keyboardOpen ? 0 : insets.bottom) + 8 }}
    >
      <Pressable
        testID="mention-picker-done"
        onPress={onDone}
        accessibilityRole="button"
        accessibilityLabel={t("picker.done_a11y", { count })}
        className="items-center justify-center rounded-lg bg-primary px-4 active:opacity-80"
        style={{ minHeight: TOUCH }}
      >
        <Text
          className="text-base font-semibold text-primary-foreground"
          numberOfLines={1}
        >
          {mentionDoneLabel(t, count)}
        </Text>
      </Pressable>
    </View>
  );
}
