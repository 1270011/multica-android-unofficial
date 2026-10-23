/**
 * Inline card for a list that could not load its first page because the
 * device is offline. Shown instead
 * of the empty state, which would claim there is nothing.
 */
import { View } from "react-native";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n";

export function ListOffline({ onRetry, testID }: { onRetry: () => void; testID: string }) {
  const { t } = useT("common");
  return (
    <View className="mx-4 mt-4 p-3 gap-3 rounded-md border border-border" testID={testID}>
      <Text className="text-sm text-muted-foreground" accessibilityLiveRegion="polite">
        {t("states.offline_load")}
      </Text>
      <Button variant="outline" onPress={onRetry}>
        <Text>{t("actions.retry")}</Text>
      </Button>
    </View>
  );
}
