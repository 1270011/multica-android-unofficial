/**
 * Hint row and empty state of the title filter (W5 P8):
 *   - "⊘ 37 hidden by title filter · Show" below the filter chips (list)
 *     or above the columns (board); no row at 0
 *   - after "Show": "Title filter off for now · Hide"
 *   - long press opens Settings › Hide issues
 *   - everything hidden: "All issues here are hidden…" with "Show"
 */
import { Pressable, View } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@/components/ui/ionicons";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { useWorkspaceStore } from "@/data/workspace-store";
import { titleFilterHint } from "@/lib/issue-title-filter";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { useT } from "@/lib/i18n";

function openTitleFilterSettings(wsSlug: string | null) {
  if (wsSlug) router.push(`/${wsSlug}/more/settings/title-filter`);
}

export function TitleFilterHint({
  hidden,
  revealed,
  onToggle,
}: {
  hidden: number;
  revealed: boolean;
  onToggle: () => void;
}) {
  const { t } = useT("issues");
  const { colorScheme } = useColorScheme();
  const wsSlug = useWorkspaceStore((s) => s.currentWorkspaceSlug);
  const kind = titleFilterHint(hidden, revealed);
  if (kind === "none") return null;
  const label =
    kind === "hidden"
      ? t("title_filter.hint", { count: hidden })
      : t("title_filter.hint_revealed");
  const action = kind === "hidden" ? t("title_filter.show") : t("title_filter.hide");
  return (
    <Pressable
      testID="title-filter-hint"
      onPress={onToggle}
      onLongPress={() => openTitleFilterSettings(wsSlug)}
      accessibilityRole="button"
      accessibilityLabel={`${label}, ${action}`}
      accessibilityHint={t("title_filter.settings_a11y")}
      accessibilityActions={[{ name: "longpress", label: t("title_filter.settings") }]}
      onAccessibilityAction={(e) => {
        if (e.nativeEvent.actionName === "longpress") openTitleFilterSettings(wsSlug);
      }}
      accessibilityLiveRegion="polite"
      hitSlop={2}
      className="mx-4 mb-2 min-h-11 flex-row items-center gap-1.5 self-start active:opacity-60"
    >
      <Ionicons
        name={kind === "hidden" ? "eye-off-outline" : "eye-outline"}
        size={14}
        color={THEME[colorScheme].mutedForeground}
      />
      <Text className="text-xs text-muted-foreground">{label} · </Text>
      <Text className="text-xs font-medium text-brand" testID="title-filter-hint-action">
        {action}
      </Text>
    </Pressable>
  );
}

export function TitleFilterAllHidden({ onShow }: { onShow: () => void }) {
  const { t } = useT("issues");
  return (
    <View className="flex-1 items-center justify-center gap-3 px-6 py-6" testID="title-filter-all-hidden">
      <Text className="text-sm text-muted-foreground text-center">
        {t("title_filter.all_hidden")}
      </Text>
      <Button
        variant="outline"
        onPress={onShow}
        className="h-11"
        hitSlop={2}
        testID="title-filter-all-hidden-show"
      >
        <Text>{t("title_filter.show")}</Text>
      </Button>
    </View>
  );
}
