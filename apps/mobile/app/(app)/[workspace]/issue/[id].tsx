/**
 * Issue detail screen.
 *
 * Read-mostly timeline with an inline comment composer pinned to the
 * bottom (`<InlineCommentComposer>`). The composer is a single
 * `<TextInput>` + mention suggestion bar — no modal route, no toolbar,
 * no draft persistence. Sticks to the keyboard via `KeyboardStickyView`.
 *
 * Header note: the parent _layout.tsx already declares the `issue/[id]`
 * Stack.Screen with title "Issue". We override that here once the data
 * lands so the navigation bar shows `MUL-123` (Linear-style).
 */
import { useCallback, useEffect, useMemo, useReducer } from "react";
import { ActivityIndicator, Alert, Linking, View } from "react-native";
import { showActionSheet } from "@/lib/action-sheet";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { useMutationState, useQuery, useQueryClient } from "@tanstack/react-query";
import * as Clipboard from "expo-clipboard";
import type { Issue, TimelineEntry } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { TimelineList } from "@/components/issue/timeline-list";
import { AgentHeaderBadge } from "@/components/issue/agent-header-badge";
import { InlineCommentComposer } from "@/components/issue/inline-comment-composer";
import {
  issueDetailOptions,
  issueKeys,
  issueTimelineOptions,
} from "@/data/queries/issues";
import { createCommentMutationKey, useDeleteIssue, useUpdateIssue } from "@/data/mutations/issues";
import { removeParentPatch } from "@/lib/issue-fields";
import {
  issueSubscribersOptions,
  useIsSubscribed,
  useIssueInbox,
  useMarkIssueDone,
  useToggleIssueSubscription,
} from "@/data/mutations/issue-chat";
import { canMarkDone } from "@/lib/issue-chat";
import { markInAppChatOpen } from "@/lib/chat-open-intent";
import { pinListOptions } from "@/data/queries/pins";
import { useCreatePin, useDeletePin } from "@/data/mutations/pins";
import { useAuthStore } from "@/data/auth-store";
import { useIssueRealtime } from "@/data/realtime/use-issue-realtime";
import { IssueChat } from "./[id]/chat";
import { IssueSummaryPane } from "@/components/issue/issue-summary-pane";
import { SegmentedPills } from "@/components/ui/segmented-pills";
import {
  INITIAL_DETAIL_PANE_STATE,
  leftPaneWidth,
  selectDetailPane,
} from "@/lib/issue-detail-layout";
import { useBreakpoint } from "@/lib/breakpoints";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useViewedIssuesStore } from "@/data/viewed-issues-store";
import { useCommentSelectStore } from "@/data/comment-select-store";
import { useReplyTargetStore } from "@/data/stores/reply-target-store";
import { useEditTargetStore } from "@/data/stores/edit-target-store";
import { useFailedCommentsStore } from "@/data/stores/failed-comments-store";
import { mergeLocalComments } from "@/lib/pending-comments";
import { guardedRefresh } from "@/lib/refresh-guard";
import { useT } from "@/lib/i18n";
import { webIssueUrl } from "@/lib/web-links";
import { getWebBaseUrl } from "@/data/server-config-store";

export default function IssueDetail() {
  // `highlight` + `h` come from inbox deep-link (apps/mobile/app/(app)/
  // [workspace]/(tabs)/inbox.tsx). `highlight` is the target comment id;
  // `h` is a per-tap nonce so re-tapping the same row re-fires the
  // scroll-and-flash effect.
  const { id, workspace: wsSlug, highlight, h, from } = useLocalSearchParams<{
    id: string;
    workspace: string;
    highlight?: string;
    h?: string;
    /** "chat" when the chat replaced itself with this detail. */
    from?: string;
  }>();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const qc = useQueryClient();

  const detail = useQuery(issueDetailOptions(wsId, id));
  const timeline = useQuery(issueTimelineOptions(wsId, id));

  // Subscribe to per-issue WS events: status/priority/assignee/label
  // changes, comments, activity, reactions, agent task progress.
  // Mounted with `id` — cleans up automatically on navigate-away.
  // If another client deletes the issue we're viewing, pop back so the
  // user isn't stranded on a 404 detail page.
  useIssueRealtime(id, () => router.back());

  // Track viewed issues so the chat composer's `@` suggestion bar can
  // surface "Recent" — the user just looked at MUL-123, likely wants to
  // ask the agent about it next. Workspace-scoped + in-memory; see
  // data/viewed-issues-store.ts.
  useEffect(() => {
    if (wsId && id) {
      useViewedIssuesStore.getState().push(wsId, id);
    }
  }, [wsId, id]);

  // Screen-scoped composer state — clear on unmount so re-entering the
  // issue starts from a clean slate (no stale text-selection comment id,
  // no stale "Replying to X" target). Both stores are singletons used by
  // the long-press action sheet.
  useEffect(() => {
    return () => {
      useCommentSelectStore.getState().clear();
      useReplyTargetStore.getState().clear();
      useEditTargetStore.getState().clear();
    };
  }, []);

  const onRefresh = useCallback(
    () =>
      guardedRefresh(async () => {
        await Promise.all([
          detail.refetch(),
          qc.invalidateQueries({ queryKey: issueKeys.timeline(wsId, id) }),
        ]);
      }),
    [detail, qc, wsId, id],
  );

  // Locally-authored comments that a refetch may have dropped from the
  // cache: queued/in-flight ones from the mutation cache, failed ones from
  // the failed-comments store.
  const pendingComments = useMutationState({
    filters: { mutationKey: createCommentMutationKey(id), status: "pending" },
    select: (m) =>
      (m.state.context as { optimistic?: TimelineEntry | null } | undefined)
        ?.optimistic ?? null,
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

  const issue = detail.data;
  const deleteIssue = useDeleteIssue();
  const updateIssue = useUpdateIssue(id);
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const { data: pins } = useQuery(pinListOptions(wsId, userId));
  const isPinned =
    !!issue &&
    !!pins?.some((p) => p.item_type === "issue" && p.item_id === issue.id);
  const createPin = useCreatePin();
  const deletePin = useDeletePin();
  const { t } = useT("issues");
  // Tablet: two panes, chat on the right by default.
  const { twoPane, width } = useBreakpoint();
  // Pane + T5 read permission of the embedded chat (lib/issue-detail-layout.ts).
  const [paneState, selectPane] = useReducer(selectDetailPane, INITIAL_DETAIL_PANE_STATE);

  // Chat button + "Done" (docs/UX.md §8.1, §3 header order
  // "Chat, ⋮"): the button carries the issue's unread inbox count, "Done"
  // sits in ⋮ while the issue has inbox entries.
  const { unread: unreadInbox, active: activeInbox } = useIssueInbox(id);
  const markDone = useMarkIssueDone(id);
  const subscribed = useIsSubscribed(id);
  const toggleSubscription = useToggleIssueSubscription(id);
  const { data: subscribers } = useQuery(issueSubscribersOptions(wsId, id));
  const subscriberCount = subscribers?.length ?? 0;
  const openChat = useCallback(() => {
    if (!wsSlug) return;
    // Two panes: the chat is already on screen, just switch to it (an
    // explicit tap, so the embedded chat may mark read — T5).
    if (twoPane) {
      selectPane("chat");
      return;
    }
    markInAppChatOpen(id);
    // Opened from the chat → swap back instead of stacking (review #12).
    if (from === "chat") {
      router.replace({ pathname: "/[workspace]/issue/[id]/chat", params: { workspace: wsSlug, id } });
      return;
    }
    router.push({
      pathname: "/[workspace]/issue/[id]/chat",
      params: { workspace: wsSlug, id, from: "detail" },
    });
  }, [wsSlug, id, from, twoPane]);

  // Three-dot menu: Pin/Unpin / Copy link / Open on web (if web URL set) /
  // Delete. Mirrors apps/mobile/app/(app)/[workspace]/project/[id].tsx — same
  // ActionSheetIOS + Alert.alert confirm pattern. Property edits (status,
  // priority, assignee, due_date) live on the IssueHeaderCard chips inside
  // the timeline list, not in this menu — one entry per action.
  const onPressMore = useCallback(() => {
    if (!issue || !wsSlug) return;
    const issueLink = webIssueUrl(getWebBaseUrl(), wsSlug, issue.identifier);
    const actions = ["cancel", "pin"];
    if (isPinned) actions[1] = "unpin";
    if (canMarkDone(issue.status, activeInbox.length)) actions.push("done");
    actions.push("edit");
    // relations, as in web's issue actions menu.
    actions.push(issue.parent_issue_id ? "change_parent" : "set_parent");
    if (issue.parent_issue_id) actions.push("remove_parent");
    if (!issue.duplicate_of) actions.push("mark_duplicate");
    // subscription, as in the chat's ⋮ menu.
    if (subscribed !== undefined) actions.push(subscribed ? "unsubscribe" : "subscribe");
    actions.push("subscribers");
    if (issueLink) actions.push("copy_link");
    if (issueLink) actions.push("open_web");
    actions.push("delete");
    const options = actions.map((action) =>
      action === "cancel"
        ? t("common:actions.cancel")
        : action === "pin"
          ? t("menu.pin")
          : action === "unpin"
            ? t("menu.unpin")
            : action === "done"
              ? t("chat.menu_done")
            : action === "subscribe"
              ? t("chat.menu_subscribe")
            : action === "unsubscribe"
              ? t("chat.menu_unsubscribe")
            : action === "subscribers"
              ? t("subscribers.menu", { count: subscriberCount })
            : action === "edit"
              ? t("menu.edit_details")
              : action === "set_parent" || action === "change_parent" || action === "remove_parent" || action === "mark_duplicate"
                ? t(`menu.${action}`)
              : action === "copy_link"
                ? t("menu.copy_link")
                : action === "open_web"
                  ? t("menu.open_web")
                  : t("menu.delete_issue"),
    );
    const destructiveIndex = options.length - 1;
    showActionSheet(
      {
        options,
        cancelButtonIndex: 0,
        destructiveButtonIndex: destructiveIndex,
        title: issue.identifier,
      },
      (i) => {
        const action = actions[i];
        if (action === "done") {
          markDone();
        } else if (action === "subscribe" || action === "unsubscribe") {
          toggleSubscription.mutate(action === "subscribe");
        } else if (action === "subscribers") {
          if (wsSlug) router.push(`/${wsSlug}/issue/${issue.id}/subscribers`);
        } else if (action === "pin") {
          createPin.mutate({ item_type: "issue", item_id: issue.id });
        } else if (action === "unpin") {
          deletePin.mutate({ itemType: "issue", itemId: issue.id });
        } else if (action === "edit") {
          if (wsSlug) router.push(`/${wsSlug}/issue/${issue.id}/edit`);
        } else if (action === "set_parent" || action === "change_parent") {
          if (wsSlug) router.push(`/${wsSlug}/issue/${issue.id}/picker/parent`);
        } else if (action === "remove_parent") {
          // Reversible and non-destructive (web applies it directly too).
          updateIssue.mutate(removeParentPatch());
        } else if (action === "mark_duplicate") {
          if (wsSlug) router.push(`/${wsSlug}/issue/${issue.id}/picker/duplicate`);
        } else if (action === "copy_link" && issueLink) {
          Clipboard.setStringAsync(issueLink);
        } else if (action === "open_web" && issueLink) {
          Linking.openURL(issueLink);
        } else if (action === "delete") {
          confirmDelete(issue, t, () =>
            deleteIssue.mutate(issue.id, {
              onSuccess: () => router.back(),
            }),
          );
        }
      },
    );
  }, [
    issue,
    wsSlug,
    deleteIssue,
    isPinned,
    createPin,
    deletePin,
    updateIssue,
    activeInbox.length,
    markDone,
    subscribed,
    subscriberCount,
    toggleSubscription,
    t,
  ]);

  return (
    <View className="flex-1 bg-background">
      <Stack.Screen
        options={{
          title: issue?.identifier ?? t("navigation:routes.issue"),
          headerBackTitle: t("common:actions.back"),
          headerRight: issue
            ? () => (
                <View className="flex-row items-center gap-2">
                  {/* Ambient agent-working badge — renders null when no
                   *  active tasks, so it doesn't crowd the header in the
                   *  common case. See agent-header-badge.tsx. */}
                  <AgentHeaderBadge issueId={id} />
                  {/* Two panes: the chat is the right pane (docs/UX.md §8.2). */}
                  {twoPane ? null : <ChatButton unread={unreadInbox.length} onPress={openChat} />}
                  <IconButton
                    name="ellipsis-horizontal"
                    onPress={onPressMore}
                    accessibilityLabel={t("menu.issue_actions")}
                  />
                </View>
              )
            : undefined,
        }}
      />
      {detail.isLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator />
        </View>
      ) : detail.error || !issue ? (
        <View className="flex-1 items-center justify-center px-6 gap-3">
          <Text className="text-sm text-destructive text-center">
            {t("errors.load_failed", {
              message:
                detail.error instanceof Error
                  ? detail.error.message
                  : "not found",
            })}
          </Text>
          <Button variant="outline" onPress={() => detail.refetch()}>
            <Text>{t("common:actions.retry")}</Text>
          </Button>
        </View>
      ) : twoPane && wsSlug ? (
        <View className="flex-1 flex-row" testID="issue-two-pane">
          <IssueSummaryPane issue={issue} width={leftPaneWidth(width)} />
          <View className="flex-1">
            <SegmentedPills
              items={[
                { value: "chat" as const, label: t("chat.title") },
                { value: "activity" as const, label: t("detail.activity") },
              ]}
              value={paneState.pane}
              onChange={selectPane}
            />
            {paneState.pane === "chat" ? (
              <View className="flex-1" testID="issue-pane-chat">
                <IssueChat
                  id={id}
                  workspace={wsSlug}
                  comment={highlight}
                  h={h}
                  embedded
                  readAllowed={paneState.chatReadAllowed}
                />
              </View>
            ) : (
              <View className="flex-1" testID="issue-pane-activity">
                <TimelineList
                  issue={issue}
                  entries={entries}
                  timelineLoading={timeline.isLoading}
                  refreshing={detail.isRefetching || timeline.isRefetching}
                  onRefresh={onRefresh}
                  highlightCommentId={highlight}
                  highlightNonce={h}
                  onOpenChat={() => selectPane("chat")}
                  hideIssueHead
                />
                <InlineCommentComposer issueId={id} />
              </View>
            )}
          </View>
        </View>
      ) : (
        <View className="flex-1">
          <TimelineList
            issue={issue}
            entries={entries}
            timelineLoading={timeline.isLoading}
            refreshing={detail.isRefetching || timeline.isRefetching}
            onRefresh={onRefresh}
            highlightCommentId={highlight}
            highlightNonce={h}
            onOpenChat={openChat}
          />
          <InlineCommentComposer issueId={id} />
        </View>
      )}
    </View>
  );
}

function ChatButton({ unread, onPress }: { unread: number; onPress: () => void }) {
  const { t } = useT("issues");
  return (
    <View>
      <IconButton
        name="chatbubbles-outline"
        onPress={onPress}
        accessibilityLabel={
          unread > 0 ? t("chat.open_chat_unread_a11y", { count: unread }) : t("chat.open_chat_a11y")
        }
      />
      {unread > 0 ? (
        <View
          pointerEvents="none"
          className="absolute right-0.5 top-0.5 min-w-[16px] h-4 px-1 rounded-full bg-destructive items-center justify-center"
        >
          <Text className="text-[10px] font-semibold text-white">{unread > 9 ? "9+" : unread}</Text>
        </View>
      ) : null}
    </View>
  );
}

function confirmDelete(
  issue: Issue,
  t: (key: string, options?: Record<string, unknown>) => string,
  onConfirm: () => void,
) {
  Alert.alert(
    t("delete.title"),
    t("delete.message", { identifier: issue.identifier }),
    [
      { text: t("common:actions.cancel"), style: "cancel" },
      { text: t("common:actions.delete"), style: "destructive", onPress: onConfirm },
    ],
  );
}
