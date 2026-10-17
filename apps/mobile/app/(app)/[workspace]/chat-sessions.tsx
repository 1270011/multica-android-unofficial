/**
 * Chat session-switch sheet — presented as a formSheet by the parent Stack.
 * Reads the session list from the chat cache and writes the user's pick
 * through a shared "active session" store so the chat tab picks it up on
 * dismiss.
 *
 * Why a tiny dedicated store: the chat tab's `activeSessionId` used to live
 * as a `useState` inside `chat.tsx`, but now that session picking happens
 * on a separate route screen, we need a cross-screen channel. Same minimum
 * pattern as `useNewIssueDraftStore` for the new-issue form.
 *
 * Session management: a "Chats | Archive" segment switches
 * between active sessions (pinned first) and the archived ones. Long-press
 * opens the session menu (rename, pin/unpin, archive/restore, delete), the
 * same actions are TalkBack custom actions on each row. Opening an archived
 * session shows it read-only (the composer explains why).
 */
import { useMemo, useState } from "react";
import {
  type AccessibilityActionEvent,
  Pressable,
  ScrollView,
  View,
} from "react-native";
import { router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import type { ChatSession } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { ActorAvatar } from "@/components/ui/actor-avatar";
import { Ionicons } from "@/components/ui/ionicons";
import { SegmentedPills } from "@/components/ui/segmented-pills";
import { useChatSessionMenu } from "@/components/chat/use-chat-session-menu";
import {
  archivedChatSessionsOptions,
  chatSessionsOptions,
} from "@/data/queries/chat";
import { useChatSessionPickerStore } from "@/data/stores/chat-session-picker-store";
import { sortChatSessions } from "@/data/mutations/chat-sessions";
import { useWorkspaceStore } from "@/data/workspace-store";
import type { ChatSessionAction } from "@/lib/chat-session-menu";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n";

type SessionView = "active" | "archived";

export default function ChatSessionsRoute() {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const { t } = useT("chat");
  const [view, setView] = useState<SessionView>("active");
  const showArchived = view === "archived";
  const active = useQuery(chatSessionsOptions(wsId));
  const archived = useQuery({
    ...archivedChatSessionsOptions(wsId),
    enabled: !!wsId && showArchived,
  });
  const shown = showArchived ? archived.data : active.data;
  // Web order at render time, also after WS patches of last_message.
  const sessions = useMemo(() => sortChatSessions(shown ?? []), [shown]);
  const activeSessionId = useChatSessionPickerStore((s) => s.activeSessionId);
  const requestSelect = useChatSessionPickerStore((s) => s.requestSelect);
  const menu = useChatSessionMenu({ from: "sheet" });

  const segments = [
    { value: "active" as const, label: t("sessions.tab_active") },
    { value: "archived" as const, label: t("sessions.tab_archived") },
  ];

  return (
    <View className="flex-1">
      <View className="px-4 pt-4 pb-1">
        <Text
          accessibilityRole="header"
          className="text-base font-semibold text-foreground"
        >
          {t("sessions.title")}
        </Text>
      </View>
      <SegmentedPills items={segments} value={view} onChange={setView} />
      <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
        {showArchived && archived.isLoading ? (
          <View className="px-4 py-8">
            <Text className="text-sm text-muted-foreground text-center">
              {t("sessions.loading")}
            </Text>
          </View>
        ) : sessions.length === 0 ? (
          <View className="px-4 py-8">
            <Text className="text-sm text-muted-foreground text-center">
              {showArchived ? t("sessions.archived_empty") : t("sessions.empty")}
            </Text>
          </View>
        ) : (
          sessions.map((session) => (
            <SessionRow
              key={session.id}
              session={session}
              selected={session.id === activeSessionId}
              onPress={() => {
                requestSelect(session.id);
                router.back();
              }}
              onLongPress={() => menu.open(session)}
              accessibilityActions={menu.accessibilityActionsFor(session)}
              onAccessibilityAction={(e) =>
                menu.run(session, e.nativeEvent.actionName as ChatSessionAction)
              }
            />
          ))
        )}
        <View className="h-6" />
      </ScrollView>
    </View>
  );
}

function SessionRow({
  session,
  selected,
  onPress,
  onLongPress,
  accessibilityActions,
  onAccessibilityAction,
}: {
  session: ChatSession;
  selected: boolean;
  onPress: () => void;
  onLongPress: () => void;
  accessibilityActions: { name: string; label: string }[];
  onAccessibilityAction: (e: AccessibilityActionEvent) => void;
}) {
  const { t } = useT("chat");
  const { colorScheme } = useColorScheme();
  const title = session.title || t("sessions.new_chat");
  const archived = session.status === "archived";
  const state = [
    session.pinned ? t("sessions.pinned") : null,
    archived ? t("sessions.archived") : null,
    session.has_unread ? t("sessions.unread") : null,
  ]
    .filter(Boolean)
    .join(", ");
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={state ? `${title}, ${state}` : title}
      accessibilityHint={t(
        archived ? "sessions.long_press_hint_archived" : "sessions.long_press_hint",
      )}
      accessibilityActions={accessibilityActions}
      onAccessibilityAction={onAccessibilityAction}
      className={cn(
        "flex-row items-center gap-3 px-4 py-3 min-h-12 active:bg-secondary",
        selected && "bg-secondary/60",
      )}
    >
      <View
        className={cn(
          "h-2 w-2 rounded-full",
          session.has_unread ? "bg-primary" : "bg-transparent",
        )}
      />
      <ActorAvatar type="agent" id={session.agent_id} size={32} showPresence />
      <View className="flex-1">
        <Text
          className={cn(
            "text-sm text-foreground",
            session.has_unread && "font-semibold",
          )}
          numberOfLines={2}
        >
          {title}
        </Text>
        {archived ? (
          <Text className="text-xs text-muted-foreground mt-0.5">
            {t("sessions.archived")}
          </Text>
        ) : null}
      </View>
      {session.pinned && !archived ? (
        <Ionicons
          name="pin"
          size={14}
          color={THEME[colorScheme].mutedForeground}
        />
      ) : null}
      {selected ? (
        <Text className="text-sm text-primary font-semibold">✓</Text>
      ) : null}
    </Pressable>
  );
}
