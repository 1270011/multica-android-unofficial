/**
 * "Duplicate of MUL-12 · title" under the attribute row. The
 * server resolves `duplicate_of` only while the issue is cancelled and the
 * original exists; tapping opens the original.
 */
import { View } from "react-native";
import { router } from "expo-router";
import type { IssueDuplicateOf } from "@multica/core/types";
import { Ionicons } from "@/components/ui/ionicons";
import { AttributeChip } from "@/components/issue/attribute-chip";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { useT } from "@/lib/i18n";

export function DuplicateOfChip({ original }: { original: IssueDuplicateOf }) {
  const wsSlug = useWorkspaceStore((s) => s.currentWorkspaceSlug);
  const { colorScheme } = useColorScheme();
  const { t } = useT("issues");
  return (
    <View className="flex-row">
      <AttributeChip
        icon={
          <Ionicons
            name="copy-outline"
            size={14}
            color={THEME[colorScheme].mutedForeground}
          />
        }
        label={t("duplicate.of", { identifier: original.identifier, title: original.title })}
        variant="dimmed"
        className="shrink"
        onPress={() => wsSlug && router.push(`/${wsSlug}/issue/${original.id}`)}
      />
    </View>
  );
}
