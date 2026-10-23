/**
 * Segment control that turns into a dropdown when the pills no longer fit
 * (at 200 % font the segments become one dropdown). Normal font: `SegmentedPills`. Large font: one full-width row
 * "<label>: <current> ▾" that opens the app's action sheet with the
 * segments, so TalkBack reads one control with the current value.
 */
import { useWindowDimensions, View } from "react-native";
import { Button } from "@/components/ui/button";
import { SegmentedPills, type SegmentItem } from "@/components/ui/segmented-pills";
import { SymbolIcon } from "@/components/ui/symbol-icon";
import { Text } from "@/components/ui/text";
import { showActionSheet } from "@/lib/action-sheet";
import { segmentsAsDropdown } from "@/lib/ai-team";
import { useT } from "@/lib/i18n";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";

interface Props<V extends string> {
  items: SegmentItem<V>[];
  value: V;
  onChange: (value: V) => void;
  /** Spoken and shown before the current value in dropdown mode. */
  label: string;
  testID?: string;
}

export function SegmentSwitch<V extends string>({ items, value, onChange, label, testID }: Props<V>) {
  const { fontScale } = useWindowDimensions();
  const { t } = useT("navigation");
  const { colorScheme } = useColorScheme();

  if (!segmentsAsDropdown(fontScale)) {
    return (
      <View testID={testID}>
        <SegmentedPills items={items} value={value} onChange={onChange} />
      </View>
    );
  }

  const current = items.find((i) => i.value === value)?.label ?? "";
  const open = () => {
    const options = [...items.map((i) => i.label), t("common:actions.cancel")];
    showActionSheet({ options, cancelButtonIndex: items.length, title: label }, (index) => {
      const picked = items[index];
      if (picked) onChange(picked.value);
    });
  };

  return (
    <View className="px-4 py-2" testID={testID}>
      <Button
        variant="outline"
        onPress={open}
        className="min-h-12 h-auto py-2 justify-between"
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${current}`}
        accessibilityHint={t("ai_team.segment_hint")}
        testID={testID ? `${testID}-dropdown` : undefined}
      >
        <Text className="flex-1 text-sm text-foreground">
          {label}: {current}
        </Text>
        <SymbolIcon name="chevron.down" size={16} color={THEME[colorScheme].mutedForeground} />
      </Button>
    </View>
  );
}
