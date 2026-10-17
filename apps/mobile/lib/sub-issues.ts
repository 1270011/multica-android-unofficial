/**
 * Pure helpers for the issue-detail "Sub-issues" section. Mirrors
 * groupSubIssuesByStage + the progress ring in
 * packages/views/issues/components/issue-detail.tsx: children are grouped
 * by `stage` (ascending, unstaged last) and progress counts every child
 * whose status sits in a terminal category (done / closed).
 */
import type { Issue } from "@multica/core/types";

export interface StageGroup {
  /** null = unstaged */
  stage: number | null;
  issues: Issue[];
}

export function groupSubIssuesByStage(issues: Issue[]): StageGroup[] {
  const groups = new Map<number | null, Issue[]>();
  for (const issue of issues) {
    const key = issue.stage ?? null;
    const list = groups.get(key) ?? [];
    list.push(issue);
    groups.set(key, list);
  }
  const staged = [...groups.entries()]
    .filter(([k]) => k !== null)
    .sort(([a], [b]) => (a as number) - (b as number))
    .map(([stage, list]) => ({ stage, issues: list }));
  const unstaged = groups.get(null);
  return unstaged ? [...staged, { stage: null, issues: unstaged }] : staged;
}

export function countTerminal(
  issues: Issue[],
  categoryOf: (status: string) => string | null | undefined,
): { done: number; total: number } {
  let done = 0;
  for (const issue of issues) {
    const category = categoryOf(issue.status);
    if (category === "done" || category === "closed" || category === "cancelled") done += 1;
  }
  return { done, total: issues.length };
}
