/**
 * "Sub-issue of PARENT-12" chip shown under the attribute row when the
 * issue has a parent (web: breadcrumb above the title). Tapping opens the
 * parent. The parent is read from the detail cache / fetched on demand.
 */
import { View } from "react-native";
import { router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { Ionicons } from "@/components/ui/ionicons";
import { AttributeChip } from "@/components/issue/attribute-chip";
import { issueDetailOptions } from "@/data/queries/issues";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { useT } from "@/lib/i18n";

export function ParentIssueChip({ parentId }: { parentId: string }) {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const wsSlug = useWorkspaceStore((s) => s.currentWorkspaceSlug);
  const { colorScheme } = useColorScheme();
  const { t } = useT("issues");
  const { data: parent } = useQuery(issueDetailOptions(wsId, parentId));
  const label = parent ? `${parent.identifier} · ${parent.title}` : t("sub_issues.parent");
  return (
    <View className="flex-row">
      <AttributeChip
        icon={
          <Ionicons
            name="git-branch-outline"
            size={14}
            color={THEME[colorScheme].mutedForeground}
          />
        }
        label={label}
        variant="dimmed"
        className="shrink"
        onPress={() => wsSlug && router.push(`/${wsSlug}/issue/${parentId}`)}
      />
    </View>
  );
}
