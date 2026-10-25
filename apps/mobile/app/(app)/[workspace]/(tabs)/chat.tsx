/**
 * Chat tab. The screen itself lives in `components/chat/chat-screen.tsx`,
 * shared with the agent chat route (`agent/[id]/chat.tsx`).
 */
import { ChatScreen } from "@/components/chat/chat-screen";

export default function ChatTab() {
  return <ChatScreen />;
}
