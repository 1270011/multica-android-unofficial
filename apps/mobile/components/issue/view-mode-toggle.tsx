/**
 * "List | Board" segment for the issue lists. Same pill style
 * as the scope toolbar next to it.
 */
import { View } from "react-native";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import type { IssueViewMode } from "@/data/stores/issue-view-mode-store";
import { useT } from "@/lib/i18n";

export function ViewModeToggle({
  mode,
  onChange,
}: {
  mode: IssueViewMode;
  onChange: (mode: IssueViewMode) => void;
}) {
  const { t } = useT("issues");
  return (
    <View className="flex-row items-center gap-1" accessibilityRole="tablist">
      {(["list", "board"] as const).map((value) => {
        const active = mode === value;
        return (
          <Button
            key={value}
            variant="outline"
            size="sm"
            onPress={() => onChange(value)}
            // sm button (36 dp) + 6 dp slop = 48 dp (docs/UX.md §4).
            hitSlop={6}
            className={active ? "bg-accent" : ""}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            testID={`view-mode-${value}`}
          >
            <Text className={active ? "text-accent-foreground" : "text-muted-foreground"}>
              {t(`board.mode_${value}`)}
            </Text>
          </Button>
        );
      })}
    </View>
  );
}
