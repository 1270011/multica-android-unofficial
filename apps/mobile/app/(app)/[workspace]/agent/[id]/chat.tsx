/**
 * Agent chat: the agent detail's "Chat" opens the chat as a
 * stack screen above the detail instead of switching to the chat tab, so
 * back (system gesture and the header arrow) returns to the agent. Same
 * screen as the tab (`components/chat/chat-screen.tsx`): it opens the
 * latest session with this agent, or a blank chat that becomes a session
 * on the first send. The id is only looked up in the agent list, never
 * acted on.
 */
import { useLocalSearchParams } from "expo-router";
import { ChatScreen } from "@/components/chat/chat-screen";

export default function AgentChat() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <ChatScreen agentId={id} />;
}
