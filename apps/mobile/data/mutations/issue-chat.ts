/**
 * Issue-level actions offered by the issue chat and the detail ⋮ menu:
 *
 *   - "Erledigt" (done): set the issue status to `done` and archive its inbox
 *     entries. The single archive endpoint archives every sibling row of the
 *     same issue server-side (see useArchiveInbox), so one call per issue is
 *     enough. Both steps reuse the existing mutations, including their
 *     optimistic patches and error toasts.
 *   - Subscription toggle: web parity for "notifications for this issue",
 *     `POST /api/issues/{id}/subscribe|unsubscribe` for the signed-in member.
 *   - Mark the issue's unread inbox entries read when the chat opens or is
 *     read to the end (same effect as opening the issue on web).
 */
import { useCallback } from "react";
import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { InboxItem, IssueSubscriber } from "@multica/core/types";
import { api } from "@/data/api";
import { issueKeys } from "@/data/queries/issue-keys";
import { inboxListOptions } from "@/data/queries/inbox";
import { useArchiveInbox, useMarkInboxRead } from "@/data/mutations/inbox";
import { useUpdateIssue } from "@/data/mutations/issues";
import { useAuthStore } from "@/data/auth-store";
import { useWorkspaceStore } from "@/data/workspace-store";
import { activeForIssue, unreadForIssue } from "@/lib/issue-chat";
import { showToast } from "@/lib/toast";
import { markIssueDoneInOrder } from "@/lib/issue-done";

export const issueSubscriberKeys = {
  list: (wsId: string | null, issueId: string) =>
    issueKeys.subscribers(wsId, issueId),
};

export const issueSubscribersOptions = (wsId: string | null, issueId: string) =>
  queryOptions({
    queryKey: issueSubscriberKeys.list(wsId, issueId),
    queryFn: ({ signal }) => api.listIssueSubscribers(issueId, { signal }),
    enabled: !!wsId && !!issueId,
  });

/** Inbox entries of one issue, read from the workspace inbox cache. */
export function useIssueInbox(issueId: string): {
  unread: InboxItem[];
  active: InboxItem[];
  loaded: boolean;
} {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const { data } = useQuery(inboxListOptions(wsId));
  return {
    unread: unreadForIssue(data, issueId),
    active: activeForIssue(data, issueId),
    loaded: data !== undefined,
  };
}

export function useIsSubscribed(issueId: string): boolean | undefined {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const { data } = useQuery(issueSubscribersOptions(wsId, issueId));
  if (!data || !userId) return undefined;
  return data.some((s) => s.user_type === "member" && s.user_id === userId);
}

export function useToggleIssueSubscription(issueId: string) {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const userId = useAuthStore((s) => s.user?.id ?? null);
  return useMutation({
    mutationFn: (subscribe: boolean) =>
      subscribe ? api.subscribeToIssue(issueId) : api.unsubscribeFromIssue(issueId),
    onMutate: async (subscribe) => {
      const key = issueSubscriberKeys.list(wsId, issueId);
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<IssueSubscriber[]>(key);
      if (prev && userId) {
        const others = prev.filter((s) => !(s.user_type === "member" && s.user_id === userId));
        qc.setQueryData<IssueSubscriber[]>(
          key,
          subscribe
            ? [
                ...others,
                {
                  issue_id: issueId,
                  user_type: "member",
                  user_id: userId,
                  reason: "manual",
                  created_at: new Date().toISOString(),
                },
              ]
            : others,
        );
      }
      return { prev, key };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(ctx.key, ctx.prev);
      showToast({ key: "issues:errors.update_failed" });
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: issueSubscriberKeys.list(wsId, issueId) });
    },
  });
}

/** "Erledigt": status done + archive the issue's inbox entries. */
export function useMarkIssueDone(issueId: string) {
  const updateIssue = useUpdateIssue(issueId);
  const archive = useArchiveInbox();
  const { active } = useIssueInbox(issueId);
  const first = active[0]?.id;
  return useCallback(
    () =>
      void markIssueDoneInOrder(
        () => updateIssue.mutateAsync({ status: "done" }),
        (inboxId) => archive.mutate(inboxId),
        first,
      ),
    [updateIssue, archive, first],
  );
}

/** Mark every unread inbox entry of the issue read; no-op when none. */
export function useMarkIssueInboxRead(issueId: string) {
  const markRead = useMarkInboxRead();
  const { unread } = useIssueInbox(issueId);
  const ids = unread.map((i) => i.id).join(",");
  return useCallback(() => {
    if (!ids) return;
    for (const id of ids.split(",")) markRead.mutate(id);
  }, [ids, markRead]);
}

/**
 * "Erledigt" from an inbox row's long-press menu, where no per-issue hook is
 * mounted. Archives only after the status write succeeded, so a failed
 * request leaves the row (and its retry path) in place.
 */
export function useMarkInboxIssueDone() {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const archive = useArchiveInbox();
  return useMutation({
    mutationFn: ({ issueId }: { issueId: string; inboxId: string }) =>
      api.updateIssue(issueId, { status: "done" }),
    onSuccess: (_issue, { inboxId }) => {
      archive.mutate(inboxId);
    },
    onError: () => {
      showToast({ key: "issues:errors.update_failed" });
    },
    onSettled: (_data, _err, { issueId }) => {
      void qc.invalidateQueries({ queryKey: issueKeys.detail(wsId, issueId) });
      void qc.invalidateQueries({ queryKey: issueKeys.myAll(wsId) });
      void qc.invalidateQueries({ queryKey: issueKeys.list(wsId) });
    },
  });
}
