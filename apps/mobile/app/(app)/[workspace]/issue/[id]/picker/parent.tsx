/**
 * Set / change / remove the parent of an existing issue.
 * Removing also clears the stage; setting/changing sends only the link
 * (lib/issue-fields.ts, same as web).
 */
import { useCallback } from "react";
import { Pressable } from "react-native";
import { useLocalSearchParams, router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import type { SearchIssueResult } from "@multica/core/types";
import { Ionicons } from "@/components/ui/ionicons";
import { Text } from "@/components/ui/text";
import { MOBILE_PLACEHOLDER_COLOR } from "@/components/ui/input-tokens";
import { IssueSearchPickerBody } from "@/components/issue/pickers/issue-search-picker-body";
import { issueDetailOptions } from "@/data/queries/issues";
import { useUpdateIssue } from "@/data/mutations/issues";
import { useWorkspaceStore } from "@/data/workspace-store";
import { parentCandidates, removeParentPatch, setParentPatch } from "@/lib/issue-fields";
import { useT } from "@/lib/i18n";

export default function IssueParentPickerRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useT("issues");
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const { data: issue } = useQuery(issueDetailOptions(wsId, id));
  const updateIssue = useUpdateIssue(id);

  const filter = useCallback(
    (results: SearchIssueResult[]) =>
      issue ? parentCandidates(results, issue) : results.filter((r) => r.id !== id),
    [issue, id],
  );

  return (
    <IssueSearchPickerBody
      testID="parent-picker"
      title={t("fields.parent")}
      placeholder={t("picker.search_issues")}
      // Done/cancelled issues can be parents too (web's IssuePickerModal
      // searches with include_closed).
      includeClosed
      filter={filter}
      onPick={(picked) => {
        updateIssue.mutate(setParentPatch(picked.id));
        router.back();
      }}
      leading={
        issue?.parent_issue_id ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              updateIssue.mutate(removeParentPatch());
              router.back();
            }}
            className="flex-row items-center gap-3 px-4 min-h-12 active:bg-secondary"
          >
            <Ionicons name="close-circle-outline" size={22} color={MOBILE_PLACEHOLDER_COLOR} />
            <Text className="flex-1 text-base text-destructive">{t("menu.remove_parent")}</Text>
          </Pressable>
        ) : null
      }
    />
  );
}
