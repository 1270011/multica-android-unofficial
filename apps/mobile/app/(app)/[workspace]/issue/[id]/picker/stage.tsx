/**
 * Stage picker for a sub-issue. Stages order siblings under a
 * parent; options and "no stage" mirror web's StagePicker
 * (lib/issue-fields.ts). Only reachable when the issue has a parent.
 */
import { useMemo } from "react";
import { FlatList, Pressable, View } from "react-native";
import { useLocalSearchParams, router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { Ionicons } from "@/components/ui/ionicons";
import { Text } from "@/components/ui/text";
import { issueChildrenOptions, issueDetailOptions } from "@/data/queries/issues";
import { useUpdateIssue } from "@/data/mutations/issues";
import { useWorkspaceStore } from "@/data/workspace-store";
import { maxSiblingStage, stageOptions } from "@/lib/issue-fields";
import { THEME } from "@/lib/theme";
import { useColorScheme } from "@/lib/use-color-scheme";
import { useT } from "@/lib/i18n";

export default function IssueStagePickerRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useT("issues");
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const { colorScheme } = useColorScheme();
  const { data: issue } = useQuery(issueDetailOptions(wsId, id));
  const parentId = issue?.parent_issue_id ?? "";
  const { data: siblings } = useQuery(issueChildrenOptions(wsId, parentId));
  const updateIssue = useUpdateIssue(id);

  const stage = issue?.stage ?? null;
  const rows = useMemo<(number | null)[]>(
    () => [null, ...stageOptions(stage, maxSiblingStage(siblings ?? []))],
    [stage, siblings],
  );

  return (
    <View className="flex-1">
      <Text className="px-4 pt-4 pb-2 text-base font-semibold text-foreground">
        {t("fields.stage")}
      </Text>
      <FlatList
        data={rows}
        keyExtractor={(row) => (row == null ? "none" : String(row))}
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected: item === stage }}
            onPress={() => {
              if (item !== stage) updateIssue.mutate({ stage: item });
              router.back();
            }}
            className="flex-row items-center gap-3 px-4 min-h-12 active:bg-secondary"
          >
            <Ionicons
              name="flag-outline"
              size={18}
              color={THEME[colorScheme].mutedForeground}
            />
            <Text className="flex-1 text-base text-foreground">
              {item == null ? t("sub_issues.unstaged") : t("sub_issues.stage", { stage: item })}
            </Text>
            {item === stage ? (
              <Ionicons name="checkmark" size={20} color={THEME[colorScheme].primary} />
            ) : null}
          </Pressable>
        )}
      />
    </View>
  );
}
