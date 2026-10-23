/**
 * Header while the issue list is in selection mode:
 *
 *   ✕  3 selected                [All (42)]
 *
 * Replaces the screen header. The count is a polite live region so TalkBack
 * announces every change. "All (n)" selects the loaded and filtered issues;
 * when the list is cut off it says "All loaded (n of total)". The batch
 * actions (D6/D7) come in a bar below the list.
 */
import { View } from "react-native";
import { Header } from "@/components/ui/header";
import { IconButton } from "@/components/ui/icon-button";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { useT } from "@/lib/i18n";

interface Props {
  count: number;
  /** Issues "All" would select (loaded and filtered). */
  visibleCount: number;
  /** Server total when the list is cut off, otherwise undefined. */
  total?: number;
  allSelected: boolean;
  onToggleAll: () => void;
  onCancel: () => void;
}

export function IssueSelectionHeader({
  count,
  visibleCount,
  total,
  allSelected,
  onToggleAll,
  onCancel,
}: Props) {
  const { t } = useT("issues");
  const truncated = total !== undefined && total > visibleCount;
  const allLabel = truncated
    ? t("selection.all_loaded", { count: visibleCount, total })
    : t("selection.all", { count: visibleCount });
  return (
    <Header
      left={
        <IconButton
          name="close"
          onPress={onCancel}
          accessibilityLabel={t("selection.cancel")}
          testID="selection-cancel"
        />
      }
      center={
        <View accessibilityLiveRegion="polite">
          <Text
            className="text-lg font-semibold text-foreground"
            numberOfLines={1}
            testID="selection-count"
          >
            {t("selection.count", { count })}
          </Text>
        </View>
      }
      right={
        <Button
          variant="outline"
          size="sm"
          onPress={onToggleAll}
          disabled={visibleCount === 0}
          className={allSelected ? "bg-accent" : ""}
          accessibilityState={{ selected: allSelected }}
          accessibilityHint={allSelected ? t("selection.none_hint") : undefined}
          testID="selection-all"
        >
          <Text numberOfLines={1}>{allLabel}</Text>
        </Button>
      }
    />
  );
}
