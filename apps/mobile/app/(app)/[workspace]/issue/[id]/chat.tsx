/**
 * Issue chat: the comment thread of
 * one issue as a messenger. A second view of the detail's data — same
 * queries (`issueDetailOptions`, `issueTimelineOptions`), same mutations
 * and pending/failed rows, same composer — so a comment sent here shows up
 * in the detail at once and vice versa.
 *
 * Entry points: the chat button in the detail header, inbox rows of
 * conversation/action types (lib/inbox-display.ts `getInboxOpenTarget`) and,
 * later, system notifications (P4b). The route is display-only (security
 * T5): it reads `comment` only to scroll/flash, never acts on parameters, and
 * rejects ids that are not UUIDs. Unknown workspaces are rejected by the
 * workspace layout.
 *
 * Header: identifier + title (tap → detail), status chip (→ status picker),
 * assignee, ⋮ (Details, Erledigt while the issue has inbox entries, copy
 * link, open on web, subscription on/off). `blocked` / `in_review` add an
 * action bar whose only button opens the status picker — no one-tap
 * approval, `done` stays a deliberate choice.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Linking, Pressable, View } from "react-native";
import { Stack, router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useMutationState, useQuery } from "@tanstack/react-query";
import * as Clipboard from "expo-clipboard";
import type { InboxItem, Issue, TimelineEntry } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Ionicons } from "@/components/ui/ionicons";
import { StatusIcon } from "@/components/ui/status-icon";
import { AgentActivityRow } from "@/components/issue/agent-activity-row";
import { InlineCommentComposer } from "@/components/issue/inline-comment-composer";
import { IssueChatList, IssueChatLoading } from "@/components/issue-chat/issue-chat-list";
import { issueDetailOptions, issueTimelineOptions } from "@/data/queries/issues";
import { createCommentMutationKey } from "@/data/mutations/issues";
import {
  useIsSubscribed,
  useIssueInbox,
  useMarkIssueDone,
  useMarkIssueInboxRead,
  useToggleIssueSubscription,
} from "@/data/mutations/issue-chat";
import { ApiError } from "@/data/api";
import { useAuthStore } from "@/data/auth-store";
import { useIssueRealtime } from "@/data/realtime/use-issue-realtime";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useViewedIssuesStore } from "@/data/viewed-issues-store";
import { useCommentSelectStore } from "@/data/comment-select-store";
import { useReplyTargetStore } from "@/data/stores/reply-target-store";
import { useEditTargetStore } from "@/data/stores/edit-target-store";
import { useFailedCommentsStore } from "@/data/stores/failed-comments-store";
import { getWebBaseUrl } from "@/data/server-config-store";
import { useActorLookup } from "@/data/use-actor-name";
import { showActionSheet } from "@/lib/action-sheet";
import { mergeLocalComments } from "@/lib/pending-comments";
import { buildChatItems, canMarkDone, isIssueId } from "@/lib/issue-chat";
import { consumeInAppChatOpen } from "@/lib/chat-open-intent";
import { showToast } from "@/lib/toast";
import { rbNotify } from "@/lib/notify/native";
import { useIssueStatuses } from "@/lib/use-issue-statuses";
import { webIssueUrl } from "@/lib/web-links";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { useT } from "@/lib/i18n";

export default function IssueChatScreen() {
  const params = useLocalSearchParams<{
    id: string;
    workspace: string;
    comment?: string;
    h?: string;
    from?: string;
    /** One-time nonce of the app's own notification (P4b, T5). */
    n?: string;
  }>();
  if (!isIssueId(params.id)) return <InvalidLink />;
  // An invalid comment anchor is dropped silently (docs/UX.md §8.5).
  const comment = isIssueId(params.comment) ? params.comment : undefined;
  return <IssueChat {...params} comment={comment} />;
}

/**
 * The chat itself. `embedded`: right pane of the two-pane tablet detail
 * — no own header, no sub-header (the left pane shows the
 * issue head), and the detail screen handles a deleted issue and owns the
 * reply/edit targets (a pane switch or rotation must not drop them). T5:
 * the detail passes `readAllowed`, true only after an explicit tap on
 * "Chat"; realtime and the composer are the same as on the chat screen.
 */
export function IssueChat({
  id,
  workspace: wsSlug,
  comment,
  h,
  from,
  n,
  embedded = false,
  readAllowed: embeddedReadAllowed = false,
}: {
  id: string;
  workspace: string;
  comment?: string;
  h?: string;
  from?: string;
  n?: string;
  embedded?: boolean;
  /** Embedded only: the detail allows marking read (T5). */
  readAllowed?: boolean;
}) {
  const { t } = useT("issues");
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const detail = useQuery(issueDetailOptions(wsId, id));
  const timeline = useQuery(issueTimelineOptions(wsId, id));
  const { unread, active, loaded: inboxLoaded } = useIssueInbox(id);
  const markRead = useMarkIssueInboxRead(id);
  const markDone = useMarkIssueDone(id);
  const subscribed = useIsSubscribed(id);
  const toggleSubscription = useToggleIssueSubscription(id);
  const [expandedGroups, setExpandedGroups] = useState<ReadonlySet<string>>(new Set());
  // T5 narrow variant (docs/UX.md §8.5): only an open from inside the app
  // (or, with P4b, from the app's own notification) marks entries read.
  // The notification nonce is checked against the app-private store of the
  // native module; a link from another app cannot carry a valid one.
  // Embedded, the detail decides and no marker is consumed here.
  const [routeReadAllowed] = useState(
    () =>
      !embedded &&
      (consumeInAppChatOpen(id) || (!!n && /^[0-9a-f]{32}$/.test(n) && rbNotify.consumeNonce(n, id))),
  );
  const readAllowed = embedded ? embeddedReadAllowed : routeReadAllowed;
  // No system notification for the issue whose chat is on screen (UX §8.4).
  // Only an open the app vouches for (readAllowed, T5) also removes the
  // existing notification; a link from another app must not (B5).
  useFocusEffect(
    useCallback(() => {
      rbNotify.setForegroundIssue(id, readAllowed);
      return () => rbNotify.clearForegroundIssue(id);
    }, [id, readAllowed]),
  );
  const markReadIfAllowed = useCallback(() => {
    if (readAllowed) markRead();
  }, [readAllowed, markRead]);

  useIssueRealtime(id, () => {
    // Embedded: the detail screen around it reacts to the deletion.
    if (!embedded) router.back();
  });

  useEffect(() => {
    if (wsId) useViewedIssuesStore.getState().push(wsId, id);
  }, [wsId, id]);

  useEffect(
    () => () => {
      if (embedded) return;
      useCommentSelectStore.getState().clear();
      useReplyTargetStore.getState().clear();
      useEditTargetStore.getState().clear();
    },
    [embedded],
  );

  // The divider is a snapshot of what was unread when the chat opened; it
  // must not jump while the entries get marked read below. Taken once the
  // inbox list is loaded (cold start from a notification may arrive first).
  const [unreadSnapshot, setUnreadSnapshot] = useState<InboxItem[] | null>(null);
  useEffect(() => {
    if (inboxLoaded && unreadSnapshot === null) setUnreadSnapshot(unread);
  }, [inboxLoaded, unreadSnapshot, unread]);
  // Opening the chat reads the issue (web parity: opening an issue).
  const unreadKey = unread.map((i) => i.id).join(",");
  useEffect(() => {
    if (unreadKey && unreadSnapshot !== null) markReadIfAllowed();
    // markRead identity follows unreadKey; run once per new unread set and
    // once more when the embedded chat gets the permission (T5).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unreadKey, unreadSnapshot !== null, readAllowed]);

  const pendingComments = useMutationState({
    filters: { mutationKey: createCommentMutationKey(id), status: "pending" },
    select: (m) =>
      (m.state.context as { optimistic?: TimelineEntry | null } | undefined)?.optimistic ?? null,
  });
  const failedComments = useFailedCommentsStore((s) => s.failed);
  const entries = useMemo(() => {
    const local: TimelineEntry[] = [];
    for (const entry of pendingComments) if (entry) local.push(entry);
    for (const failed of Object.values(failedComments)) {
      if (failed.issueId === id) local.push(failed.entry);
    }
    return mergeLocalComments(timeline.data, local);
  }, [timeline.data, pendingComments, failedComments, id]);

  const items = useMemo(
    () => buildChatItems(entries, { userId, unreadInbox: unreadSnapshot ?? [], expandedGroups }),
    [entries, userId, unreadSnapshot, expandedGroups],
  );

  const onExpandGroup = useCallback((groupId: string) => {
    setExpandedGroups((prev) => new Set(prev).add(groupId));
  }, []);

  const issue = detail.data;

  const openDetails = useCallback(() => {
    // Came from the detail of this issue → go back instead of stacking it twice.
    if (from === "detail" && router.canGoBack()) router.back();
    // Otherwise the detail replaces the chat, so chat and detail never pile
    // up: Inbox → Chat → Details → Chat → Back lands on the Inbox (review #12).
    else router.replace({ pathname: "/[workspace]/issue/[id]", params: { workspace: wsSlug, id, from: "chat" } });
  }, [from, wsSlug, id]);

  const onPressMore = useCallback(() => {
    if (!issue) return;
    const link = webIssueUrl(getWebBaseUrl(), wsSlug, issue.identifier);
    const actions: { label: string; run: () => void }[] = [
      { label: t("chat.menu_details"), run: openDetails },
    ];
    if (canMarkDone(issue.status, active.length)) actions.push({ label: t("chat.menu_done"), run: markDone });
    if (link) {
      actions.push({ label: t("menu.copy_link"), run: () => void Clipboard.setStringAsync(link) });
      actions.push({ label: t("menu.open_web"), run: () => void Linking.openURL(link) });
    }
    if (subscribed !== undefined) {
      actions.push({
        label: subscribed ? t("chat.menu_unsubscribe") : t("chat.menu_subscribe"),
        run: () => toggleSubscription.mutate(!subscribed),
      });
    }
    showActionSheet(
      {
        options: [t("common:actions.cancel"), ...actions.map((a) => a.label)],
        cancelButtonIndex: 0,
        title: issue.identifier,
      },
      (i) => {
        if (i > 0) actions[i - 1]?.run();
      },
    );
  }, [issue, wsSlug, active.length, subscribed, openDetails, markDone, toggleSubscription, t]);

  const notFound =
    detail.error instanceof ApiError && (detail.error.status === 404 || detail.error.status === 403);

  return (
    <View className="flex-1 bg-background">
      {embedded ? null : (
      <Stack.Screen
        options={{
          title: issue?.identifier ?? t("chat.title"),
          headerBackTitle: t("common:actions.back"),
          headerTitle: issue
            ? () => <ChatTitle issue={issue} onPress={openDetails} />
            : undefined,
          headerRight: issue
            ? () => (
                <IconButton
                  name="ellipsis-vertical"
                  onPress={onPressMore}
                  accessibilityLabel={t("menu.issue_actions")}
                />
              )
            : undefined,
        }}
      />
      )}
      {notFound ? (
        <IssueGone />
      ) : detail.isLoading ? (
        <IssueChatLoading />
      ) : detail.error || !issue ? (
        <View className="flex-1 items-center justify-center px-6 gap-3">
          <Text className="text-sm text-destructive text-center">
            {t("errors.load_failed", {
              message: detail.error instanceof Error ? detail.error.message : "not found",
            })}
          </Text>
          <Button variant="outline" onPress={() => detail.refetch()}>
            <Text>{t("common:actions.retry")}</Text>
          </Button>
        </View>
      ) : (
        <View className="flex-1">
          {embedded ? null : <ChatSubHeader issue={issue} wsSlug={wsSlug} />}
          <ActionBar issue={issue} wsSlug={wsSlug} />
          {timeline.isLoading && !entries ? (
            <IssueChatLoading />
          ) : timeline.error && !entries ? (
            <View className="flex-1 items-center justify-center px-6 gap-3">
              <Text className="text-sm text-destructive text-center">{t("chat.load_failed")}</Text>
              <Button variant="outline" onPress={() => timeline.refetch()}>
                <Text>{t("common:actions.retry")}</Text>
              </Button>
            </View>
          ) : items.length === 0 ? (
            <View className="flex-1 items-center justify-center px-8">
              <Text className="text-sm text-muted-foreground text-center">{t("chat.empty")}</Text>
            </View>
          ) : (
            <IssueChatList
              items={items}
              issueId={id}
              issueIdentifier={issue.identifier}
              targetCommentId={comment}
              targetNonce={h}
              onExpandGroup={onExpandGroup}
              onReachEnd={markReadIfAllowed}
              footer={<AgentActivityRow issueId={id} />}
            />
          )}
          <InlineCommentComposer issueId={id} />
        </View>
      )}
    </View>
  );
}

function ChatTitle({ issue, onPress }: { issue: Issue; onPress: () => void }) {
  const { t } = useT("issues");
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={t("chat.open_details_a11y", { identifier: issue.identifier, title: issue.title })}
      className="min-h-[48px] justify-center"
      style={{ maxWidth: 240 }}
    >
      <Text className="text-xs text-muted-foreground" numberOfLines={1}>
        {issue.identifier}
      </Text>
      <Text className="text-sm font-semibold text-foreground" numberOfLines={1}>
        {issue.title}
      </Text>
    </Pressable>
  );
}

function ChatSubHeader({ issue, wsSlug }: { issue: Issue; wsSlug: string }) {
  const { t } = useT("issues");
  const catalog = useIssueStatuses();
  const { getName } = useActorLookup();
  const assignee =
    issue.assignee_type && issue.assignee_id
      ? getName(issue.assignee_type as "member" | "agent" | "squad", issue.assignee_id)
      : null;
  return (
    <View className="flex-row items-center gap-3 px-4 py-1 border-b border-border">
      <Pressable
        onPress={() =>
          router.push({
            pathname: "/[workspace]/issue/[id]/picker/status",
            params: { workspace: wsSlug, id: issue.id },
          })
        }
        accessibilityRole="button"
        accessibilityLabel={t("chat.status_a11y", { status: catalog.labelOf(issue.status) })}
        className="min-h-[48px] flex-row items-center gap-1.5 active:opacity-60"
      >
        <StatusIcon
          status={issue.status}
          category={catalog.categoryOf(issue.status)}
          icon={catalog.iconOf(issue.status)}
          color={catalog.colorOf(issue.status)}
          size={14}
        />
        <Text className="text-sm text-foreground">{catalog.labelOf(issue.status)}</Text>
        <Text className="text-xs text-muted-foreground">▾</Text>
      </Pressable>
      {assignee ? (
        <Text className="text-sm text-muted-foreground shrink" numberOfLines={1}>
          · {assignee}
        </Text>
      ) : null}
    </View>
  );
}

function ActionBar({ issue, wsSlug }: { issue: Issue; wsSlug: string }) {
  const { t } = useT("issues");
  const { colorScheme } = useColorScheme();
  if (issue.status !== "blocked" && issue.status !== "in_review") return null;
  const text = issue.status === "blocked" ? t("chat.action_blocked") : t("chat.action_review");
  return (
    <View
      className="flex-row items-center gap-3 px-4 py-2 bg-muted/60 border-b border-border"
      accessibilityRole="summary"
    >
      <Ionicons
        name={issue.status === "blocked" ? "alert-circle-outline" : "flag-outline"}
        size={18}
        color={THEME[colorScheme].foreground}
      />
      <Text className="flex-1 text-sm font-medium text-foreground">{text}</Text>
      <Button
        size="sm"
        variant="outline"
        onPress={() =>
          router.push({
            pathname: "/[workspace]/issue/[id]/picker/status",
            params: { workspace: wsSlug, id: issue.id },
          })
        }
        accessibilityLabel={t("chat.change_status")}
        className="min-h-[48px]"
      >
        <Text>{t("chat.change_status")}</Text>
      </Button>
    </View>
  );
}

/** Invalid issue id from a deep link → Inbox with a toast (docs/UX.md §8.5). */
function InvalidLink() {
  const wsSlug = useWorkspaceStore((s) => s.currentWorkspaceSlug);
  useEffect(() => {
    showToast({ key: "issues:chat.invalid_link" });
    router.replace(wsSlug ? `/${wsSlug}/inbox` : "/");
  }, [wsSlug]);
  return <View className="flex-1 bg-background" />;
}

function IssueGone() {
  const { t } = useT("issues");
  const wsSlug = useWorkspaceStore((s) => s.currentWorkspaceSlug);
  return (
    <View className="flex-1 items-center justify-center px-6 gap-3 bg-background">
      <Stack.Screen options={{ title: t("chat.title") }} />
      <Text className="text-base text-foreground text-center">{t("chat.gone")}</Text>
      <Button
        variant="outline"
        onPress={() => (wsSlug ? router.replace(`/${wsSlug}/inbox`) : router.replace("/"))}
      >
        <Text>{t("chat.to_inbox")}</Text>
      </Button>
    </View>
  );
}
