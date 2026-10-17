/**
 * Rename a chat session. formSheet route, opened from the
 * session menu (`useChatSessionMenu`):
 *
 *   /[workspace]/chat-session-rename?id=<sessionId>
 *
 * Android has no `Alert.prompt`, so the prompt is a small sheet with one
 * field. Same rules as the server (trimmed, 1–200 characters); Save stays
 * disabled until the title changes. The optimistic `useRenameChatSession`
 * patches the list, the sheet closes right away.
 */
import { useEffect, useState } from "react";
import { Pressable, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import type { ChatSession } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { TextField } from "@/components/ui/text-field";
import {
  archivedChatSessionsOptions,
  chatSessionOptions,
  chatSessionsOptions,
} from "@/data/queries/chat";
import { useRenameChatSession } from "@/data/mutations/chat-sessions";
import { useWorkspaceStore } from "@/data/workspace-store";
import {
  CHAT_SESSION_TITLE_MAX,
  checkChatSessionTitle,
} from "@/lib/chat-session-menu";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export default function ChatSessionRenameRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useT("chat");
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const { data: active = [] } = useQuery(chatSessionsOptions(wsId));
  const { data: archived = [] } = useQuery({
    ...archivedChatSessionsOptions(wsId),
    enabled: false,
  });
  const cached = [...active, ...archived].find((s) => s.id === id);
  // Deep link or evicted cache: read the session itself.
  const { data: fetched } = useQuery(chatSessionOptions(wsId, cached ? null : id));
  const session: ChatSession | null | undefined = cached ?? fetched;
  const rename = useRenameChatSession();

  const [title, setTitle] = useState("");
  const [seeded, setSeeded] = useState(false);
  useEffect(() => {
    if (seeded || !session) return;
    setTitle(session.title ?? "");
    setSeeded(true);
  }, [session, seeded]);

  const check = checkChatSessionTitle(title, session?.title ?? "");
  const tooLong = !check.ok && check.reason === "too_long";

  const onSave = () => {
    if (!check.ok || !session) return;
    rename.mutate({ sessionId: session.id, title: check.title });
    router.back();
  };

  return (
    <View className="flex-1 px-4 pt-4 gap-3">
      <View className="flex-row items-center justify-between">
        <Text
          accessibilityRole="header"
          className="text-base font-semibold text-foreground"
        >
          {t("rename.title")}
        </Text>
        <Pressable
          onPress={onSave}
          disabled={!check.ok}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityState={{ disabled: !check.ok }}
          className={cn("px-2 py-1 active:opacity-60", !check.ok && "opacity-40")}
        >
          <Text className="text-sm text-primary font-semibold">
            {t("rename.save")}
          </Text>
        </Pressable>
      </View>
      <TextField
        value={title}
        onChangeText={setTitle}
        placeholder={t("sessions.new_chat")}
        accessibilityLabel={t("rename.label")}
        autoFocus
        selectTextOnFocus
        returnKeyType="done"
        onSubmitEditing={onSave}
        invalid={tooLong}
        // maxLength counts UTF-16 units; 2× leaves room for emoji, the
        // character check above enforces the server limit (review #23).
        maxLength={CHAT_SESSION_TITLE_MAX * 2}
      />
      {tooLong ? (
        <Text className="text-xs text-destructive" accessibilityLiveRegion="polite">
          {t("rename.too_long", { max: CHAT_SESSION_TITLE_MAX })}
        </Text>
      ) : null}
    </View>
  );
}
