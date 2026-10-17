/**
 * "Sub-issues" section of the issue detail — between the description and
 * the activity timeline, like the web detail
 * (packages/views/issues/components/issue-detail.tsx, SubIssueRow).
 * Children are grouped by stage with a done/total progress line; each
 * row navigates to the child. Renders nothing while loading or when the
 * issue has no children, so the common case costs no vertical space.
 */
import { View } from "react-native";
import { router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import type { Issue } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { IssueRow } from "@/components/issue/issue-row";
import { issueChildrenOptions } from "@/data/queries/issues";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useIssueStatuses } from "@/lib/use-issue-statuses";
import { countTerminal, groupSubIssuesByStage } from "@/lib/sub-issues";
import { useT } from "@/lib/i18n";

export function SubIssuesSection({ issueId }: { issueId: string }) {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const wsSlug = useWorkspaceStore((s) => s.currentWorkspaceSlug);
  const { t } = useT("issues");
  const { categoryOf } = useIssueStatuses();
  const { data } = useQuery(issueChildrenOptions(wsId, issueId));
  const children = data ?? [];
  if (children.length === 0) return null;

  const { done, total } = countTerminal(children, categoryOf);
  const groups = groupSubIssuesByStage(children);
  const showStages = groups.some((g) => g.stage !== null);
  const open = (child: Issue) => {
    if (wsSlug) router.push(`/${wsSlug}/issue/${child.id}`);
  };

  return (
    <View className="border-t border-border pt-3 pb-1">
      <View className="px-4 pb-1 flex-row items-center justify-between">
        <Text className="text-xs uppercase tracking-wider text-muted-foreground font-medium">
          {t("sub_issues.title")}
        </Text>
        <Text className="text-xs text-muted-foreground">
          {t("sub_issues.progress", { done, total })}
        </Text>
      </View>
      <View className="mx-4 h-1 rounded-full bg-secondary overflow-hidden">
        <View
          className="h-1 rounded-full bg-brand"
          style={{ width: `${total ? Math.round((done / total) * 100) : 0}%` }}
        />
      </View>
      {groups.map((group) => (
        <View key={group.stage ?? "unstaged"}>
          {showStages ? (
            <Text className="px-4 pt-3 pb-1 text-xs text-muted-foreground">
              {group.stage === null
                ? t("sub_issues.unstaged")
                : t("sub_issues.stage", { stage: group.stage })}
            </Text>
          ) : (
            <View className="h-2" />
          )}
          {group.issues.map((child) => (
            <IssueRow key={child.id} issue={child} showStatus onPress={() => open(child)} />
          ))}
        </View>
      ))}
    </View>
  );
}
