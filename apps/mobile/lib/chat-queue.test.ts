import { describe, expect, it, vi } from "vitest";
import type { ChatPendingTask } from "@multica/core/types";
import de from "../locales/de/chat.json";
import en from "../locales/en/chat.json";
import zh from "../locales/zh-Hans/chat.json";
import { queuePreview, queuedTasksOf, sendNowState, sendQueuedNow, pendingAfterSendNow } from "./chat-queue";

const pending: ChatPendingTask = {
  task_id: "head",
  status: "running",
  supports_queue: true,
  queued_tasks: [
    { task_id: "q1", status: "queued", created_at: "", content: "first" },
    { task_id: "q2", status: "queued", created_at: "", content: "second" },
  ],
};

describe("queuedTasksOf", () => {
  it("returns the queue behind a head task, else nothing", () => {
    expect(queuedTasksOf(pending).map((t) => t.task_id)).toEqual(["q1", "q2"]);
    expect(queuedTasksOf({})).toEqual([]);
    expect(queuedTasksOf(undefined)).toEqual([]);
    expect(queuedTasksOf({ task_id: "head" })).toEqual([]);
  });
});

describe("sendNowState (web chat-queue.tsx)", () => {
  it("allows send-now only while the head task runs", () => {
    expect(sendNowState("running", false)).toBe("ok");
    expect(sendNowState("dispatched", false)).toBe("ok");
    expect(sendNowState("waiting_local_directory", false)).toBe("ok");
    expect(sendNowState("queued", false)).toBe("wait");
    expect(sendNowState(undefined, false)).toBe("wait");
  });
  it("blocks it when the user may no longer run the agent (MUL-6380)", () => {
    expect(sendNowState("running", true)).toBe("no_permission");
  });
});

describe("queuePreview", () => {
  it("collapses whitespace, shortens long text, null without text", () => {
    expect(queuePreview({ content: "  a\n\n b  " })).toBe("a b");
    expect(queuePreview({ content: "x".repeat(200) }, 10)).toBe(`${"x".repeat(9)}…`);
    expect(queuePreview({ content: "" })).toBeNull();
    expect(queuePreview({})).toBeNull();
  });
});

describe("sendQueuedNow", () => {
  it("prioritizes, then stops the active run the server names", async () => {
    const cancel = vi.fn(async () => {});
    const res = await sendQueuedNow("s", "q2", {
      prioritize: async () => ({ task_id: "q2", active_task_id: "head" }),
      cancel,
    });
    expect(res).toEqual({ ok: true, stopped: "head" });
    expect(cancel).toHaveBeenCalledWith("head");
  });

  it("does not cancel anything without an active run", async () => {
    const cancel = vi.fn(async () => {});
    expect(await sendQueuedNow("s", "q1", { prioritize: async () => ({ task_id: "q1" }), cancel })).toEqual({
      ok: true,
      stopped: null,
    });
    expect(cancel).not.toHaveBeenCalled();
  });

  it("reports a failed or wrong prioritize as not prioritized (roll back)", async () => {
    const wrong = await sendQueuedNow("s", "q1", { prioritize: async () => ({ task_id: "other" }), cancel: vi.fn() });
    expect(wrong).toMatchObject({ ok: false, prioritized: false });
    const failed = await sendQueuedNow("s", "q1", {
      prioritize: async () => {
        throw Object.assign(new Error("conflict"), { status: 409 });
      },
      cancel: vi.fn(),
    });
    expect(failed).toMatchObject({ ok: false, prioritized: false });
  });

  it("keeps the new order when only stopping the old run failed", async () => {
    const res = await sendQueuedNow("s", "q1", {
      prioritize: async () => ({ task_id: "q1", active_task_id: "head" }),
      cancel: async () => {
        throw new Error("already finished");
      },
    });
    expect(res).toMatchObject({ ok: false, prioritized: true });
  });
});

describe("queue strings", () => {
  const KEYS = ["title_other", "send_now", "send_now_wait", "send_now_no_permission", "clear", "send_now_confirm_title", "send_now_confirm_message", "clear_confirm_title", "clear_confirm_message_other", "fallback", "failed", "send_now_unavailable"];
  for (const [lang, file] of Object.entries({ de, en, "zh-Hans": zh })) {
    it(`${lang} has every queue key`, () => {
      const q = (file as unknown as { queue: Record<string, string> }).queue;
      for (const k of KEYS) expect(q?.[k], `${lang}:queue.${k}`).toBeTypeOf("string");
    });
  }
});

describe("pendingAfterSendNow (stopped run leaves at once, J3b)", () => {
  const q = (id: string) => ({ task_id: id, content: id }) as never;
  it("drops the stopped run and promotes the prioritized message", () => {
    const pending = { task_id: "run", status: "running", queued_tasks: [q("next"), q("later")] } as never;
    const after = pendingAfterSendNow(pending, "run");
    expect(after?.task_id).toBe("next");
    expect(after?.queued_tasks?.map((t) => t.task_id)).toEqual(["later"]);
  });
  it("leaves the cache alone when nothing was stopped", () => {
    const pending = { task_id: "run", status: "running", queued_tasks: [] } as never;
    expect(pendingAfterSendNow(pending, null)).toBe(pending);
  });
});
