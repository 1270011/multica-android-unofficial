// @vitest-environment node
/**
 * Agent chat as a stack route: "Chat" in the agent detail opens
 * `agent/[id]/chat` above the detail, so back returns to the agent. The
 * chat tab stays mounted underneath and shares the session-picker store;
 * the screen focused last owns it.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { useChatSessionPickerStore } from "@/data/stores/chat-session-picker-store";

const read = (path: string) => readFileSync(join(__dirname, "..", path), "utf8");

describe("chat session picker owner", () => {
  beforeEach(() => {
    useChatSessionPickerStore.setState({
      activeSessionId: null,
      selectRequest: null,
      owner: null,
    });
  });

  it("the screen focused last claims the store", () => {
    const s = useChatSessionPickerStore.getState();
    s.claim("tab");
    s.claim("agent-chat");
    expect(useChatSessionPickerStore.getState().owner).toBe("agent-chat");
  });

  it("a workspace reset clears the slots but keeps the owner", () => {
    const s = useChatSessionPickerStore.getState();
    s.claim("tab");
    s.setActiveSessionId("s1");
    s.requestSelect("s2");
    s.reset();
    expect(useChatSessionPickerStore.getState()).toMatchObject({
      owner: "tab",
      activeSessionId: null,
      selectRequest: null,
    });
  });
});

describe("agent chat route", () => {
  it("the agent detail's Chat pushes the stack route, not the chat tab", () => {
    const src = read("components/agents/agent-action-row.tsx");
    expect(src).toContain('pathname: "/[workspace]/agent/[id]/chat"');
    expect(src).not.toContain('pathname: "/[workspace]/chat"');
  });

  it("the route renders the shared chat screen with the agent id", () => {
    const src = read("app/(app)/[workspace]/agent/[id]/chat.tsx");
    expect(src).toContain("<ChatScreen agentId={id} />");
    expect(read("app/(app)/[workspace]/(tabs)/chat.tsx")).toContain("<ChatScreen />");
  });

  it("is registered in the workspace stack without the native header", () => {
    const src = read("app/(app)/[workspace]/_layout.tsx");
    expect(src).toMatch(/name="agent\/\[id\]\/chat"\s+options=\{\{ headerShown: false \}\}/);
  });

  it("only the owning screen mirrors and consumes the picker store", () => {
    const src = read("components/chat/chat-screen.tsx");
    expect(src).toContain("if (ownsPicker) setStoreActiveSessionId(activeSessionId);");
    expect(src).toContain("if (!selectRequest || !ownsPicker) return;");
  });

  it("never falls back to another agent without a selection or session", () => {
    const src = read("components/chat/chat-screen.tsx");
    const fallback = src.indexOf("return availableAgents[0] ?? null;");
    const own = src.indexOf(
      "if (agentId) return availableAgents.find((a) => a.id === agentId) ?? null;",
    );
    expect(own).toBeGreaterThan(-1);
    expect(own).toBeLessThan(fallback);
  });

  it("shows a back arrow only in the agent chat", () => {
    const src = read("components/chat/chat-screen.tsx");
    expect(src).toMatch(/left=\{\s*agentId \? \(\s*<IconButton\s+name="arrow-back"/);
  });
});
