/**
 * Session management menu: rename, pin/unpin, archive/restore
 * and delete (with confirmation). One implementation for the long-press
 * menu in the session sheet, the ⋮ menu in the chat header and the TalkBack
 * actions on each session row (`accessibilityActions`).
 *
 * Rename opens the `chat-session-rename` formSheet route (Android has no
 * `Alert.prompt`). From inside the session sheet it replaces that sheet
 * instead of stacking a second one (`from: "sheet"`).
 */
import { Alert } from "react-native";
import { router } from "expo-router";
import type { ChatSession } from "@multica/core/types";
import {
  useSetChatSessionArchived,
  useSetChatSessionPinned,
} from "@/data/mutations/chat-sessions";
import { useDeleteChatSession } from "@/data/mutations/chat";
import { useChatSessionPickerStore } from "@/data/stores/chat-session-picker-store";
import { useWorkspaceStore } from "@/data/workspace-store";
import { showActionSheet } from "@/lib/action-sheet";
import {
  chatSessionActions,
  deleteChatSessionFlow,
  type ChatSessionAction,
} from "@/lib/chat-session-menu";
import { useT } from "@/lib/i18n";

export function useChatSessionMenu({ from }: { from: "sheet" | "chat" }) {
  const { t } = useT("chat");
  const wsSlug = useWorkspaceStore((s) => s.currentWorkspaceSlug);
  const requestSelect = useChatSessionPickerStore((s) => s.requestSelect);
  const setPinned = useSetChatSessionPinned();
  const setArchived = useSetChatSessionArchived();
  const deleteSession = useDeleteChatSession();

  const labelOf = (action: ChatSessionAction) => t(`sessions.actions.${action}`);
  const titleOf = (session: ChatSession) => session.title || t("sessions.new_chat");

  const run = (session: ChatSession, action: ChatSessionAction) => {
    switch (action) {
      case "rename": {
        if (!wsSlug) return;
        const target = {
          pathname: "/[workspace]/chat-session-rename" as const,
          params: { workspace: wsSlug, id: session.id },
        };
        if (from === "sheet") router.replace(target);
        else router.push(target);
        return;
      }
      case "pin":
      case "unpin":
        setPinned.mutate({ sessionId: session.id, pinned: action === "pin" });
        return;
      case "archive":
      case "restore":
        setArchived.mutate({
          sessionId: session.id,
          archived: action === "archive",
        });
        return;
      case "delete":
        Alert.alert(
          t("alerts.delete_title"),
          titleOf(session),
          [
            { text: t("common:actions.cancel"), style: "cancel" },
            {
              text: t("alerts.delete_confirm"),
              style: "destructive",
              onPress: () => {
                // Leave the chat only after the server deleted it (J3b);
                // mutateAsync, because the menu may unmount meanwhile.
                void deleteChatSessionFlow({
                  remove: () => deleteSession.mutateAsync(session.id),
                  isOpen: () => useChatSessionPickerStore.getState().activeSessionId === session.id,
                  leave: () => requestSelect(null),
                  onFailed: () => Alert.alert(t("alerts.delete_failed_title"), t("alerts.delete_failed_message")),
                });
              },
            },
          ],
          { cancelable: true },
        );
        return;
    }
  };

  const open = (session: ChatSession) => {
    const actions = chatSessionActions(session);
    const deleteIndex = actions.indexOf("delete");
    showActionSheet(
      {
        options: [t("common:actions.cancel"), ...actions.map(labelOf)],
        cancelButtonIndex: 0,
        destructiveButtonIndex: deleteIndex >= 0 ? deleteIndex + 1 : undefined,
        title: titleOf(session),
      },
      (i) => {
        const action = actions[i - 1];
        if (i > 0 && action) run(session, action);
      },
    );
  };

  /** TalkBack / VoiceOver custom actions for a session row. */
  const accessibilityActionsFor = (session: ChatSession) =>
    chatSessionActions(session).map((name) => ({ name, label: labelOf(name) }));

  return { open, run, accessibilityActionsFor };
}
