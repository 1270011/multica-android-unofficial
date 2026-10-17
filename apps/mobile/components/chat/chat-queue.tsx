/**
 * Waiting messages above the composer. Web parity:
 * packages/views/chat/components/chat-queue.tsx — the list of messages
 * queued behind the current run, "Send now" (web: Steer) per message and
 * "Clear all". Phone adaptations: both actions ask first (send-now stops
 * the current run; clear drops messages for good), and the list scrolls
 * inside a fixed height so the chat keeps its room.
 *
 * Without queued messages it renders nothing. The messages themselves stay
 * hidden in the chat list while queued (`hideQueuedChatMessages`), so this
 * panel is where the user sees them.
 */
import { useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, View } from "react-native";
import type { ChatQueuedTask } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { Ionicons } from "@/components/ui/ionicons";
import { queuePreview, type SendNowState } from "@/lib/chat-queue";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export function ChatQueue({
  tasks,
  sendNowState,
  onSendNow,
  onClear,
}: {
  tasks: ChatQueuedTask[];
  sendNowState: SendNowState;
  onSendNow: (taskId: string) => Promise<unknown>;
  onClear: () => Promise<unknown>;
}) {
  const { t } = useT("chat");
  const { colorScheme } = useColorScheme();
  const muted = THEME[colorScheme].mutedForeground;
  const [busyAction, setBusyAction] = useState<"send" | "clear" | null>(null);
  const busy = busyAction !== null;

  if (tasks.length === 0) return null;

  const run = (kind: "send" | "clear", action: () => Promise<unknown>) => {
    setBusyAction(kind);
    void action().finally(() => setBusyAction(null));
  };

  const confirmSendNow = (task: ChatQueuedTask) => {
    Alert.alert(t("queue.send_now_confirm_title"), t("queue.send_now_confirm_message"), [
      { text: t("common:actions.cancel"), style: "cancel" },
      { text: t("queue.send_now"), onPress: () => run("send", () => onSendNow(task.task_id)) },
    ]);
  };

  const confirmClear = () => {
    Alert.alert(
      t("queue.clear_confirm_title"),
      t("queue.clear_confirm_message", { count: tasks.length }),
      [
        { text: t("common:actions.cancel"), style: "cancel" },
        { text: t("queue.clear"), style: "destructive", onPress: () => run("clear", onClear) },
      ],
    );
  };

  const canSendNow = sendNowState === "ok" && !busy;
  const sendNowLabel =
    sendNowState === "ok"
      ? t("queue.send_now")
      : sendNowState === "no_permission"
        ? t("queue.send_now_no_permission")
        : t("queue.send_now_wait");

  return (
    <View className="mx-3 mb-1 rounded-lg border border-border bg-secondary/40" testID="chat-queue">
      <View className="flex-row items-center gap-2 px-3 pt-2 pb-1">
        <Ionicons name="time-outline" size={14} color={muted} />
        {/* Only the count is announced when it changes, not the whole list. */}
        <Text
          accessibilityRole="header"
          accessibilityLiveRegion="polite"
          className="flex-1 text-xs font-medium text-muted-foreground"
        >
          {t("queue.title", { count: tasks.length })}
        </Text>
        <Pressable
          onPress={confirmClear}
          disabled={busy}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={t("queue.clear")}
          accessibilityState={{ disabled: busy, busy: busyAction === "clear" }}
          className={cn(
            "min-h-9 flex-row items-center gap-1.5 px-2 active:opacity-60",
            busy && "opacity-40",
          )}
          testID="chat-queue-clear"
        >
          {busyAction === "clear" ? <ActivityIndicator size="small" testID="chat-queue-clear-busy" /> : null}
          <Text className="text-xs font-medium text-destructive">{t("queue.clear")}</Text>
        </Pressable>
      </View>
      <ScrollView style={{ maxHeight: 132 }} nestedScrollEnabled>
        {tasks.map((task) => {
          const preview = queuePreview(task) ?? t("queue.fallback");
          return (
            <View
              key={task.task_id}
              className="flex-row items-center gap-2 px-3 py-1.5"
              testID="chat-queue-row"
            >
              <Text className="flex-1 text-sm text-foreground" numberOfLines={2}>
                {preview}
              </Text>
              <Pressable
                onPress={() => confirmSendNow(task)}
                disabled={!canSendNow}
                hitSlop={6}
                accessibilityRole="button"
                accessibilityLabel={`${sendNowLabel}: ${preview}`}
                accessibilityState={{ disabled: !canSendNow, busy: busyAction === "send" }}
                className={cn(
                  "min-h-9 flex-row items-center gap-1 rounded-md border border-border px-2 active:bg-secondary",
                  !canSendNow && "opacity-40",
                )}
                testID="chat-queue-send-now"
              >
                <Ionicons name="return-down-forward-outline" size={14} color={muted} />
                <Text className="text-xs text-foreground">{t("queue.send_now")}</Text>
              </Pressable>
            </View>
          );
        })}
      </ScrollView>
      {sendNowState !== "ok" ? (
        <Text className="px-3 pb-2 text-xs text-muted-foreground">{sendNowLabel}</Text>
      ) : (
        <View className="h-1.5" />
      )}
    </View>
  );
}
