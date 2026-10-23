/**
 * Left pane of the two-pane issue detail on tablets: the
 * same head the single-pane timeline shows above the activity — header
 * card, description, reactions, sub-issues, wakeups. `focusWakeups`
 * (W8, `?section=wakeups`) lands on the wakeups until the user drags.
 */
import { useRef } from "react";
import { ScrollView } from "react-native";
import type { Issue } from "@multica/core/types";
import { IssueHeaderCard } from "./issue-header-card";
import { IssueDescription } from "./issue-description";
import { IssueReactionRow } from "./issue-reaction-row";
import { SubIssuesSection } from "./sub-issues-section";
import { WakeupsSection } from "./wakeups-section";

export function IssueSummaryPane({
  issue,
  width,
  focusWakeups = false,
}: {
  issue: Issue;
  width: number;
  focusWakeups?: boolean;
}) {
  const scrollRef = useRef<ScrollView>(null);
  const wakeupsY = useRef(0);
  const landingDone = useRef(!focusWakeups);
  return (
    <ScrollView
      ref={scrollRef}
      // Exactly `width`: a ScrollView grows by default (flexGrow 1), so it
      // would share the free space with the chat (1280 dp → 909 / 371
      // instead of 538 / 742).
      style={{ width, flexGrow: 0, flexShrink: 0 }}
      className="border-r border-border"
      onScrollBeginDrag={() => {
        landingDone.current = true;
      }}
      testID="issue-summary-pane"
    >
      <IssueHeaderCard
        issue={issue}
        onShowWakeups={() => scrollRef.current?.scrollTo({ y: wakeupsY.current, animated: true })}
      />
      <IssueDescription issueId={issue.id} description={issue.description} />
      <IssueReactionRow issue={issue} />
      <SubIssuesSection issueId={issue.id} />
      <WakeupsSection
        issueId={issue.id}
        status={issue.status}
        expand={focusWakeups}
        onLayout={(e) => {
          wakeupsY.current = e.nativeEvent.layout.y;
          if (!landingDone.current) scrollRef.current?.scrollTo({ y: wakeupsY.current, animated: false });
        }}
      />
    </ScrollView>
  );
}
