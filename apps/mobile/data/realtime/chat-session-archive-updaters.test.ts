import { describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import type { ChatSession } from "@multica/core/types";
import { applySessionUpdated, dropSessionFromList } from "./chat-ws-updaters";
import { chatKeys } from "@/data/queries/chat";

vi.mock("@/data/api", () => ({ api: {} }));

// realtime events keep the Archive view current.
const WS = "ws-1";
const session = (id: string, over: Partial<ChatSession> = {}): ChatSession =>
  ({
    id,
    title: id,
    status: "active",
    pinned: false,
    created_at: "2026-10-01T00:00:00Z",
    updated_at: "2026-10-01T00:00:00Z",
    ...over,
  }) as ChatSession;

function setup() {
  const qc = new QueryClient();
  qc.setQueryData(chatKeys.sessions(WS), [
    session("a", { updated_at: "2026-10-03T00:00:00Z" }),
    session("b", { updated_at: "2026-10-02T00:00:00Z" }),
  ]);
  qc.setQueryData(chatKeys.archivedSessions(WS), [session("old", { status: "archived" })]);
  return qc;
}
const ids = (qc: QueryClient, key: readonly unknown[]) =>
  qc.getQueryData<ChatSession[]>(key)?.map((s) => s.id);

describe("applySessionUpdated", () => {
  it("renames in both lists without refetching", () => {
    const qc = setup();
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    applySessionUpdated(qc, WS, { chat_session_id: "old", title: "Neu" });
    applySessionUpdated(qc, WS, { chat_session_id: "b", title: "B2" });
    expect(qc.getQueryData<ChatSession[]>(chatKeys.archivedSessions(WS))?.[0].title).toBe("Neu");
    expect(qc.getQueryData<ChatSession[]>(chatKeys.sessions(WS))?.[1].title).toBe("B2");
    expect(invalidate).not.toHaveBeenCalled();
  });

  it("applies a pin from another device and re-sorts pinned first", () => {
    const qc = setup();
    applySessionUpdated(qc, WS, { chat_session_id: "b", pinned: true });
    expect(ids(qc, chatKeys.sessions(WS))).toEqual(["b", "a"]);
    applySessionUpdated(qc, WS, { chat_session_id: "b", pinned: false });
    expect(ids(qc, chatKeys.sessions(WS))).toEqual(["a", "b"]);
  });

  it("refetches both lists on archive/restore (status change)", () => {
    const qc = setup();
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    applySessionUpdated(qc, WS, { chat_session_id: "a", status: "archived" });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: chatKeys.sessions(WS) });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: chatKeys.archivedSessions(WS) });
  });
});

describe("single-session cache (open archived chat, review #23)", () => {
  it("patches a renamed archived chat and refetches it on a status change", () => {
    const qc = setup();
    qc.setQueryData(chatKeys.session(WS, "old"), session("old", { status: "archived" }));
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    applySessionUpdated(qc, WS, { chat_session_id: "old", title: "Renamed" });
    expect(qc.getQueryData<ChatSession>(chatKeys.session(WS, "old"))?.title).toBe("Renamed");
    expect(invalidate).not.toHaveBeenCalled();
    applySessionUpdated(qc, WS, { chat_session_id: "old", status: "active" });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: chatKeys.session(WS, "old") });
  });
});

describe("dropSessionFromList", () => {
  it("removes a deleted session from the active and the archived list", () => {
    const qc = setup();
    dropSessionFromList(qc, WS, { chat_session_id: "old" } as never);
    dropSessionFromList(qc, WS, { chat_session_id: "a" } as never);
    expect(ids(qc, chatKeys.archivedSessions(WS))).toEqual([]);
    expect(ids(qc, chatKeys.sessions(WS))).toEqual(["b"]);
  });
});
