/**
 * "Chat" and "New issue" for one agent
 * (W2). Web parity: the DM / "Assign work" buttons on the agent page. Both
 * stay visible when the agent cannot be invoked, disabled, with the reason
 * as a line underneath that TalkBack reads as the buttons' hint.
 */
import { View } from "react-native";
import { router } from "expo-router";
import { useTheme } from "@react-navigation/native";
import { useQuery } from "@tanstack/react-query";
import type { Agent } from "@multica/core/types";
import { Button } from "@/components/ui/button";
import { Ionicons } from "@/components/ui/ionicons";
import { Text } from "@/components/ui/text";
import { useAuthStore } from "@/data/auth-store";
import { memberListOptions } from "@/data/queries/members";
import { useWorkspaceStore } from "@/data/workspace-store";
import {
  AGENT_ACTION_BLOCK_KEY,
  agentActionBlock,
  agentAssigneeParam,
} from "@/lib/agent-actions";
import { useT } from "@/lib/i18n";

export function AgentActionRow({ agent }: { agent: Agent }) {
  const { t } = useT("workspace");
  const { colors } = useTheme();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const wsSlug = useWorkspaceStore((s) => s.currentWorkspaceSlug);
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const { data: members, isFetched } = useQuery(memberListOptions(wsId));
  const role = members?.find((m) => m.user_id === userId)?.role ?? null;

  // Until the member list is in, the role is unknown: keep the row neutral
  // (disabled, no reason) instead of flashing "no access".
  const block = isFetched ? agentActionBlock(agent, { userId, role }) : null;
  const disabled = !isFetched || block !== null || !wsSlug;
  const reason = block ? t(AGENT_ACTION_BLOCK_KEY[block]) : undefined;

  const openChat = () => {
    if (!wsSlug) return;
    // A stack screen above this detail, not the chat tab: switching tabs
    // would close the stack and back would land on the previous tab.
    router.push({
      pathname: "/[workspace]/agent/[id]/chat",
      params: { workspace: wsSlug, id: agent.id },
    });
  };
  const openNewIssue = () => {
    if (!wsSlug) return;
    router.push({
      pathname: "/[workspace]/new-issue",
      params: { workspace: wsSlug, assignee: agentAssigneeParam(agent.id) },
    });
  };

  const iconColor = colors.text;
  return (
    <View
      className="px-4 pt-4 gap-2"
      accessibilityLabel={t("agent.actions.label", { name: agent.name })}
      testID="agent-actions"
    >
      {/* Wraps under each other at large font scales (200 %). */}
      <View className="flex-row flex-wrap gap-2">
        <Button
          variant="outline"
          className="min-h-12 flex-1 min-w-36 flex-row gap-2"
          disabled={disabled}
          onPress={openChat}
          accessibilityLabel={t("agent.actions.chat_a11y", { name: agent.name })}
          accessibilityHint={reason}
          accessibilityState={{ disabled }}
          testID="agent-action-chat"
        >
          <Ionicons name="chatbubbles-outline" size={18} color={iconColor} />
          <Text>{t("agent.actions.chat")}</Text>
        </Button>
        <Button
          variant="outline"
          className="min-h-12 flex-1 min-w-36 flex-row gap-2"
          disabled={disabled}
          onPress={openNewIssue}
          accessibilityLabel={t("agent.actions.new_issue_a11y", { name: agent.name })}
          accessibilityHint={reason}
          accessibilityState={{ disabled }}
          testID="agent-action-new-issue"
        >
          <Ionicons name="add-circle-outline" size={18} color={iconColor} />
          <Text>{t("agent.actions.new_issue")}</Text>
        </Button>
      </View>
      {reason ? (
        <Text className="text-sm text-muted-foreground" testID="agent-actions-reason">
          {reason}
        </Text>
      ) : null}
    </View>
  );
}
