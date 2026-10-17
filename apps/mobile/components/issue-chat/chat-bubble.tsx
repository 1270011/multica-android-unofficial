/**
 * One comment in the issue chat. Own messages
 * sit right on a brand tint (`bg-brand/15`), others left on `bg-muted` with
 * avatar and name on the first bubble of an author group. Divergence from
 * the §8.2 sketch (solid `bg-brand`): the shared Markdown renderer paints
 * mention chips, links and code with the foreground palette, which has no
 * contrast on a solid brand fill in dark mode; a tint keeps one renderer for
 * both sides. Replies carry a quote of their thread
 * root; tapping it jumps there. A mention of the signed-in member gets a
 * brand border plus an "@you" tag (not colour alone).
 *
 * Interactions reuse the detail screen's plumbing: long-press opens the same
 * comment menu (`useCommentLongPress` — Reply first), swipe right sets the
 * reply target, and the pending/failed states come from the same stores.
 * Swipe is never the only path: `accessibilityActions` offer reply, react
 * and the full menu.
 *
 * At large font scales (≥ 1.5) bubbles take the full width and the avatar
 * moves away; name and time stay above the bubble.
 */
import { useCallback, useMemo, useRef } from "react";
import { Pressable, View, useWindowDimensions } from "react-native";
import Animated, {
  runOnJS,
  useAnimatedReaction,
  type SharedValue,
} from "react-native-reanimated";
import ReanimatedSwipeable, {
  type SwipeableMethods,
} from "react-native-gesture-handler/ReanimatedSwipeable";
import * as Haptics from "expo-haptics";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Reaction, TimelineEntry } from "@multica/core/types";
import { Ionicons } from "@/components/ui/ionicons";
import { Text } from "@/components/ui/text";
import { ActorAvatar } from "@/components/ui/actor-avatar";
import { Markdown } from "@/lib/markdown";
import { CommentAttachmentList } from "@/components/issue/comment-attachment-list";
import { ReactionBar } from "@/components/issue/reaction-bar";
import { FailedActions, PendingHint } from "@/components/issue/comment-card";
import { useCommentLongPress } from "@/components/issue/comment-context-menu";
import {
  discardFailedComment,
  useCreateComment,
  useToggleCommentReaction,
} from "@/data/mutations/issues";
import { issueAttachmentsOptions } from "@/data/queries/issues";
import { useFailedCommentsStore } from "@/data/stores/failed-comments-store";
import { useReplyTargetStore } from "@/data/stores/reply-target-store";
import { useAuthStore } from "@/data/auth-store";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useActorLookup } from "@/data/use-actor-name";
import { isOptimisticCommentId } from "@/lib/pending-comments";
import type { ReplyQuote } from "@/lib/issue-chat";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { continuousCorners } from "@/lib/radius";
import { useT } from "@/lib/i18n";
import { formatChatTime } from "./format";

const SWIPE_WIDTH = 64;
const LARGE_FONT_SCALE = 1.5;

interface Props {
  entry: TimelineEntry;
  issueId: string;
  issueIdentifier: string | undefined;
  own: boolean;
  groupStart: boolean;
  replyTo: ReplyQuote | null;
  mentionsMe: boolean;
  resolved: boolean;
  highlighted: boolean;
  onPressQuote: (rootId: string) => void;
}

export function ChatBubble({
  entry,
  issueId,
  issueIdentifier,
  own,
  groupStart,
  replyTo,
  mentionsMe,
  resolved,
  highlighted,
  onPressQuote,
}: Props) {
  const { t } = useT("issues");
  const { fontScale } = useWindowDimensions();
  const large = fontScale >= LARGE_FONT_SCALE;
  const { getName } = useActorLookup();
  const { colorScheme } = useColorScheme();
  const userId = useAuthStore((s) => s.user?.id);
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const qc = useQueryClient();
  const toggle = useToggleCommentReaction(issueId);
  const createComment = useCreateComment(issueId);
  const failed = useFailedCommentsStore((s) => s.failed[entry.id]);
  const pending = !failed && isOptimisticCommentId(entry.id);
  const { data: attachments } = useQuery(issueAttachmentsOptions(wsId, issueId));
  const longPress = useCommentLongPress(entry, issueId, issueIdentifier);
  const swipeRef = useRef<SwipeableMethods>(null);

  const name =
    entry.actor_name ||
    getName(entry.actor_type as "member" | "agent" | null | undefined, entry.actor_id);
  const quoteName = replyTo
    ? replyTo.actorName ||
      getName(replyTo.actorType as "member" | "agent" | null | undefined, replyTo.actorId)
    : "";
  const time = formatChatTime(entry.created_at);
  const edited = !!entry.updated_at && entry.updated_at !== entry.created_at;
  const reactions = useMemo(() => (entry.reactions ?? []) as Reaction[], [entry.reactions]);
  const attachmentCount = entry.attachments?.length ?? 0;

  const setReply = useCallback(() => {
    useReplyTargetStore.getState().setTarget({
      commentId: entry.id,
      actorName: name || t("comments.fallback_actor"),
      preview: entry.content ?? "",
    });
  }, [entry.id, entry.content, name, t]);

  const onToggleReaction = useCallback(
    (emoji: string) => {
      const existing = reactions.find(
        (r) => r.emoji === emoji && r.actor_type === "member" && r.actor_id === userId,
      );
      toggle.mutate({ commentId: entry.id, emoji, existing });
    },
    [reactions, userId, toggle, entry.id],
  );

  const onRetry = useCallback(() => {
    if (!failed || !wsId) return;
    discardFailedComment(qc, wsId, issueId, entry.id);
    createComment.mutate({
      content: failed.content,
      parentId: failed.parentId,
      attachmentIds: failed.attachmentIds,
      sentAt: failed.sentAt,
    });
  }, [failed, qc, wsId, issueId, entry.id, createComment]);

  const onDiscard = useCallback(() => {
    if (wsId) discardFailedComment(qc, wsId, issueId, entry.id);
  }, [qc, wsId, issueId, entry.id]);

  const a11yLabel = [
    own ? t("chat.a11y_you") : name,
    time,
    mentionsMe ? t("chat.mention_you") : null,
    replyTo ? t("chat.a11y_reply_to", { name: quoteName }) : null,
    entry.content ?? "",
    attachmentCount > 0 ? t("chat.a11y_attachments", { count: attachmentCount }) : null,
    reactions.length > 0 ? t("chat.a11y_reactions", { count: reactions.length }) : null,
    resolved ? t("chat.resolved") : null,
    failed ? t("failed.send") : pending ? t("chat.sending") : null,
  ]
    .filter(Boolean)
    .join(", ");

  const showHeader = groupStart || large;
  const interactive = !pending;

  const bubble = (
    <View
      className={cn(
        "rounded-2xl px-3.5 py-2.5 gap-1.5 border-2",
        own ? "bg-brand/15" : "bg-muted",
        mentionsMe ? "border-brand" : "border-transparent",
        highlighted && "border-primary/60",
        resolved && "opacity-60",
      )}
      style={continuousCorners}
    >
      {replyTo ? (
        <Pressable
          onPress={() => onPressQuote(replyTo.rootId)}
          accessibilityRole="button"
          accessibilityLabel={t("chat.jump_to_root", { name: quoteName })}
          className={cn(
            "rounded-lg border-l-2 px-2 py-1 active:opacity-70",
            "border-brand bg-background/60",
          )}
        >
          <Text
            className="text-xs font-semibold text-foreground"
            numberOfLines={1}
          >
            ↪ {quoteName}
          </Text>
          <Text
            className="text-xs text-muted-foreground"
            numberOfLines={1}
          >
            {replyTo.deleted ? t("chat.deleted_root") : replyTo.preview || "…"}
          </Text>
        </Pressable>
      ) : null}
      {mentionsMe ? (
        <Text className="text-[11px] font-semibold text-brand">
          {t("chat.mention_you")}
        </Text>
      ) : null}
      {entry.content ? <Markdown content={entry.content} attachments={attachments} /> : null}
      <CommentAttachmentList attachments={entry.attachments} content={entry.content} />
      <View className="flex-row items-center justify-end gap-1">
        {resolved ? (
          <Text className="text-[11px] text-muted-foreground">
            {t("chat.resolved")} ·
          </Text>
        ) : null}
        <Text className="text-[11px] text-muted-foreground">
          {time}
          {edited ? ` · ${t("chat.edited")}` : ""}
        </Text>
        {own && !pending && !failed ? (
          <Ionicons
            name="checkmark"
            size={12}
            color={THEME[colorScheme].mutedForeground}
            accessibilityLabel={t("chat.sent")}
          />
        ) : null}
      </View>
    </View>
  );

  const content = (
    <View
      className={cn("px-3", own ? "items-end" : "items-start")}
      accessible
      accessibilityLabel={a11yLabel}
      accessibilityActions={
        interactive
          ? [
              { name: "reply", label: t("comments.reply") },
              { name: "react", label: t("comments.react") },
              { name: "menu", label: t("chat.more_actions") },
            ]
          : undefined
      }
      onAccessibilityAction={(e) => {
        if (e.nativeEvent.actionName === "reply") setReply();
        else if (e.nativeEvent.actionName === "react" || e.nativeEvent.actionName === "menu")
          longPress.onLongPress();
      }}
    >
      {showHeader && !own ? (
        <View className="flex-row items-center gap-2 mb-1 ml-1">
          {!large ? (
            <ActorAvatar
              type={entry.actor_type as "member" | "agent"}
              id={entry.actor_id}
              name={entry.actor_name}
              avatarUrl={entry.actor_avatar_url}
              size={20}
              showPresence
            />
          ) : null}
          <Text className="text-xs font-medium text-foreground">{name}</Text>
        </View>
      ) : null}
      <View className={large ? "w-full" : "max-w-[85%]"}>
        {interactive ? (
          <Pressable onLongPress={longPress.onLongPress} delayLongPress={450}>
            {bubble}
          </Pressable>
        ) : (
          bubble
        )}
      </View>
      {failed ? (
        <View className="mt-1 w-[85%]">
          <FailedActions error={failed.error} onRetry={onRetry} onDiscard={onDiscard} />
        </View>
      ) : pending ? (
        <PendingHint />
      ) : reactions.length > 0 ? (
        <View className="mt-1">
          <ReactionBar reactions={reactions} currentUserId={userId} onToggle={onToggleReaction} />
        </View>
      ) : null}
    </View>
  );

  if (!interactive) return content;

  return (
    <ReanimatedSwipeable
      ref={swipeRef}
      friction={2}
      leftThreshold={SWIPE_WIDTH}
      overshootLeft={false}
      renderLeftActions={(_progress, drag) => <ReplyAction drag={drag} />}
      onSwipeableWillOpen={() => {
        setReply();
        swipeRef.current?.close();
      }}
    >
      {content}
    </ReanimatedSwipeable>
  );
}

function ReplyAction({ drag }: { drag: SharedValue<number> }) {
  const { colorScheme } = useColorScheme();
  useAnimatedReaction(
    () => drag.value >= SWIPE_WIDTH,
    (crossed, prev) => {
      if (crossed && !prev) runOnJS(Haptics.selectionAsync)();
    },
    [],
  );
  return (
    <Animated.View style={{ width: SWIPE_WIDTH }} className="items-center justify-center">
      <Ionicons name="arrow-undo-outline" size={20} color={THEME[colorScheme].mutedForeground} />
    </Animated.View>
  );
}
