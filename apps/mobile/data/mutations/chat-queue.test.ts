import { describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import type { ChatMessage, ChatPendingTask } from "@multica/core/types";

vi.mock("@/data/api", () => ({ api: {}, ApiError: class extends Error {} }));
vi.mock("@/lib/toast", () => ({ showToast: vi.fn() }));
vi.mock("@/data/workspace-store", () => ({
  useWorkspaceStore: () => "ws-1",
}));

import { chatKeys } from "@/data/queries/chat";
import { applyQueueCleared } from "./chat-sessions";

// "Clear all" drops the queued messages and the queue, keeps
// the running head task and the rest of the transcript.
describe("applyQueueCleared", () => {
  it("removes queued messages and the queue, keeps the head task", () => {
    const qc = new QueryClient();
    const s = "session-1";
    qc.setQueryData<ChatPendingTask>(chatKeys.pendingTask(s), {
      task_id: "head",
      status: "running",
      supports_queue: true,
      queued_tasks: [
        { task_id: "q1", status: "queued", created_at: "", message_id: "m-q1" },
        { task_id: "q2", status: "queued", created_at: "" },
      ],
    });
    qc.setQueryData<ChatMessage[]>(chatKeys.messages(s), [
      { id: "m-1" } as ChatMessage,
      { id: "m-q1" } as ChatMessage,
    ]);

    applyQueueCleared(qc, s);

    expect(qc.getQueryData<ChatMessage[]>(chatKeys.messages(s))?.map((m) => m.id)).toEqual(["m-1"]);
    const pending = qc.getQueryData<ChatPendingTask>(chatKeys.pendingTask(s));
    expect(pending?.task_id).toBe("head");
    expect(pending?.queued_tasks ?? []).toEqual([]);
  });
});
