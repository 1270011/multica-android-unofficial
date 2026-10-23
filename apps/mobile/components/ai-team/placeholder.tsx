/**
 * Placeholder content of the "AI Team" pages (Autopilots, Wakeups,
 * Runtimes). The real lists replace it; the feature notice stays for
 * servers that answer 404.
 */
import { View } from "react-native";
import { SymbolIcon, type SymbolName } from "@/components/ui/symbol-icon";
import { Text } from "@/components/ui/text";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";

export function AiTeamPlaceholder({
  icon,
  title,
  body,
  testID,
}: {
  icon: SymbolName;
  title: string;
  body: string;
  testID: string;
}) {
  const { colorScheme } = useColorScheme();
  return (
    <View
      className="flex-1 items-center justify-center px-8 py-12 gap-3"
      accessible
      accessibilityLabel={`${title}. ${body}`}
      testID={testID}
    >
      <SymbolIcon name={icon} size={32} color={THEME[colorScheme].mutedForeground} />
      <Text className="text-base font-medium text-foreground text-center">{title}</Text>
      <Text className="text-sm text-muted-foreground text-center">{body}</Text>
    </View>
  );
}
