/**
 * Shown when the chat tab opened an agent's latest session from the agent
 * detail's "Chat" button (F2): says which chat this is and offers
 * a visible "New chat" with the same agent (the web's DM behaviour).
 */
import { View } from "react-native";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { useT } from "@/lib/i18n";

export function AgentHandoverBar({
  agentName,
  onNewChat,
}: {
  agentName: string;
  onNewChat: () => void;
}) {
  const { t } = useT("chat");
  return (
    <View
      className="mx-3 mb-1.5 flex-row flex-wrap items-center gap-x-2 rounded-md bg-secondary px-2.5"
      testID="chat-agent-handover"
    >
      <Text className="flex-1 min-w-32 py-2 text-xs text-muted-foreground">
        {t("agent_handover.latest", { name: agentName })}
      </Text>
      <Button
        variant="ghost"
        size="sm"
        className="min-h-12"
        onPress={onNewChat}
        accessibilityLabel={t("agent_handover.new_chat_a11y", { name: agentName })}
        testID="chat-agent-handover-new"
      >
        <Text>{t("agent_handover.new_chat")}</Text>
      </Button>
    </View>
  );
}
