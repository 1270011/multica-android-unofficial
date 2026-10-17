/**
 * Left pane of the two-pane issue detail on tablets: the
 * same head the single-pane timeline shows above the activity — header
 * card, description, reactions, sub-issues.
 */
import { ScrollView } from "react-native";
import type { Issue } from "@multica/core/types";
import { IssueHeaderCard } from "./issue-header-card";
import { IssueDescription } from "./issue-description";
import { IssueReactionRow } from "./issue-reaction-row";
import { SubIssuesSection } from "./sub-issues-section";

export function IssueSummaryPane({ issue, width }: { issue: Issue; width: number }) {
  return (
    <ScrollView style={{ width }} className="border-r border-border" testID="issue-summary-pane">
      <IssueHeaderCard issue={issue} />
      <IssueDescription issueId={issue.id} description={issue.description} />
      <IssueReactionRow issue={issue} />
      <SubIssuesSection issueId={issue.id} />
    </ScrollView>
  );
}
