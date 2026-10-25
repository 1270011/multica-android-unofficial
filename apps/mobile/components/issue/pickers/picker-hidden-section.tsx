/**
 * "Hidden" section header for the pickers (A4.3): while
 * searching, people and agents hidden in Settings › View come back below it,
 * dimmed and still pickable. TalkBack reads it as a header; the rows carry
 * the "hidden" note in text, not only by colour
 * (§Barrierefreiheit).
 */
import { View } from "react-native";
import { Text } from "@/components/ui/text";

export function PickerHiddenSection({
  label,
  compact = false,
}: {
  label: string;
  /** Suggestion-bar size. */
  compact?: boolean;
}) {
  return (
    <View
      testID="picker-hidden-section"
      accessibilityRole="header"
      className={compact ? "px-3 pt-2 pb-1 border-t border-border/60 mt-1" : "px-4 pt-4 pb-1"}
    >
      <Text
        className={
          compact
            ? "text-[10px] uppercase tracking-wider text-muted-foreground/80 font-medium"
            : "text-[11px] font-medium uppercase tracking-wide text-muted-foreground"
        }
      >
        {label}
      </Text>
    </View>
  );
}
