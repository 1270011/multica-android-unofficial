/**
 * Mark an issue as a duplicate of another. The
 * server also sets the status to cancelled; v0.6.1 can only undo the mark
 * by changing the status again, so the user confirms first. With an empty
 * search box the list suggests issues with the same title.
 */
import { useCallback } from "react";
import { Alert } from "react-native";
import { useLocalSearchParams, router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import type { SearchIssueResult } from "@multica/core/types";
import { IssueSearchPickerBody } from "@/components/issue/pickers/issue-search-picker-body";
import { issueDetailOptions } from "@/data/queries/issues";
import { useUpdateIssue } from "@/data/mutations/issues";
import { useWorkspaceStore } from "@/data/workspace-store";
import { duplicateCandidates } from "@/lib/issue-fields";
import { useT } from "@/lib/i18n";

export default function IssueDuplicatePickerRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useT("issues");
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const { data: issue } = useQuery(issueDetailOptions(wsId, id));
  const updateIssue = useUpdateIssue(id);

  const filter = useCallback(
    (results: SearchIssueResult[]) => duplicateCandidates(results, id),
    [id],
  );

  const confirm = (original: SearchIssueResult) => {
    Alert.alert(
      t("duplicate.confirm_title"),
      t("duplicate.confirm_message", { identifier: original.identifier }),
      [
        { text: t("common:actions.cancel"), style: "cancel" },
        {
          text: t("duplicate.confirm_action"),
          style: "destructive",
          onPress: () => {
            updateIssue.mutate({ duplicate_of_issue_id: original.id });
            router.back();
          },
        },
      ],
    );
  };

  return (
    <IssueSearchPickerBody
      testID="duplicate-picker"
      title={t("menu.mark_duplicate")}
      placeholder={t("picker.search_issues")}
      initialQuery={issue?.title}
      includeClosed
      filter={filter}
      onPick={confirm}
    />
  );
}
