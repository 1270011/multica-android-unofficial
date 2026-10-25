/**
 * Suggestion chip "Reply to <agent>" above the comment composer
 * (W1-P4, `lib/reply-suggestion.ts`). Shown collapsed and expanded while no
 * reply or edit target is set; a tap sets the reply target to the suggested
 * comment, which expands and focuses the composer. Never set automatically.
 * Touch target ≥ 48 dp.
 */
import { Pressable, View } from "react-native";
import { Ionicons } from "@/components/ui/ionicons";
import { Text } from "@/components/ui/text";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { useT } from "@/lib/i18n";

export function ReplySuggestionChip({
  name,
  onPress,
}: {
  name: string;
  onPress: () => void;
}) {
  const { t } = useT("issues");
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  const label = t("comments.suggest_reply", { name });
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={t("comments.suggest_reply_hint", { name })}
      testID="reply-suggestion"
      className="min-h-12 justify-center self-start active:opacity-70"
    >
      <View className="flex-row items-center gap-1.5 rounded-full border border-border bg-secondary/60 px-3 py-1">
        <Ionicons name="return-up-back" size={14} color={theme.mutedForeground} />
        <Text className="text-xs font-medium text-foreground" numberOfLines={1}>
          {label}
        </Text>
      </View>
    </Pressable>
  );
}
