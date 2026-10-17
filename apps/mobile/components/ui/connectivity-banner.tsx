/**
 * Thin app-wide "Offline" bar. Driven by NetInfo through
 * `useIsOnline()`; renders nothing while online. Mounted once in the root
 * layout below the navigation tree so every screen — including sign-in —
 * shows the same notice. The bar owns the bottom safe-area inset; the
 * content above is wrapped in its own SafeAreaProvider so tab bars and
 * composers do not add the inset a second time.
 */
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@/components/ui/ionicons";
import { Text } from "@/components/ui/text";
import { useIsOnline } from "@/lib/network-status";
import { useT } from "@/lib/i18n";

export function ConnectivityBanner() {
  const online = useIsOnline();
  const insets = useSafeAreaInsets();
  const { t } = useT("common");
  if (online) return null;
  return (
    <View
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      testID="connectivity-banner"
      className="flex-row items-center justify-center gap-2 bg-warning px-4 pt-1.5"
      style={{ paddingBottom: insets.bottom + 6 }}
    >
      <Ionicons name="cloud-offline-outline" size={14} color="#1c1917" />
      <Text className="text-xs font-medium" style={{ color: "#1c1917" }}>
        {t("states.offline_banner")}
      </Text>
    </View>
  );
}
