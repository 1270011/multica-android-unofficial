/**
 * Chat queue: messages that
 * wait for the current run. Mirrors packages/views/chat/components
 * (chat-queue.tsx, use-chat-task-actions.ts):
 *
 * - The queue is `pendingTask.queued_tasks`; the realtime hook keeps the
 *   pending task fresh on every `task:*` event, so the panel follows.
 * - "Send now" (web: Steer) prioritizes the message and then stops the run
 *   the server names as `active_task_id`. Only while the head task is
 *   dispatched/running/waiting for its directory, and only if the user may
 *   still run the agent (MUL-6380).
 * - "Clear" drops every queued message; the messages list is reloaded
 *   afterwards.
 */
import type {
  ChatPendingTask,
  ChatQueuedTask,
  PrioritizeQueuedChatTaskResponse,
} from "@multica/core/types";
import { removePendingChatTask } from "@multica/core/chat/pending";

export function queuedTasksOf(pending: ChatPendingTask | undefined): ChatQueuedTask[] {
  return pending?.task_id ? pending.queued_tasks ?? [] : [];
}

export type SendNowState = "ok" | "wait" | "no_permission";

const DISPATCHABLE = new Set(["dispatched", "running", "waiting_local_directory"]);

export function sendNowState(headStatus: string | undefined, accessRevoked: boolean): SendNowState {
  if (accessRevoked) return "no_permission";
  return headStatus && DISPATCHABLE.has(headStatus) ? "ok" : "wait";
}

/** One-line preview of a queued message; null when it has no text. */
export function queuePreview(task: Pick<ChatQueuedTask, "content">, max = 140): string | null {
  const text = (task.content ?? "").replace(/\s+/g, " ").trim();
  if (!text) return null;
  return [...text].length > max ? `${[...text].slice(0, max - 1).join("")}…` : text;
}

/**
 * Send a queued message now: prioritize, then stop the active run if the
 * server names one. `prioritized` tells the caller whether the optimistic
 * reorder may stay (true) or must be rolled back (false) on failure.
 */
export async function sendQueuedNow(
  sessionId: string,
  taskId: string,
  deps: {
    prioritize: (sessionId: string, taskId: string) => Promise<PrioritizeQueuedChatTaskResponse>;
    cancel: (taskId: string) => Promise<void>;
  },
): Promise<{ ok: true; stopped: string | null } | { ok: false; prioritized: boolean; error: unknown }> {
  let prioritized = false;
  try {
    const result = await deps.prioritize(sessionId, taskId);
    if (result.task_id !== taskId) throw new Error("invalid prioritize response");
    prioritized = true;
    if (result.active_task_id) {
      await deps.cancel(result.active_task_id);
      return { ok: true, stopped: result.active_task_id };
    }
    return { ok: true, stopped: null };
  } catch (error) {
    return { ok: false, prioritized, error };
  }
}

/**
 * Pending task after a successful "Send now": the run the server
 * stopped leaves the cache at once, like web's cancel path
 * (`removePendingChatTask`), instead of staying "running" until a refetch.
 */
export function pendingAfterSendNow(
  pending: ChatPendingTask | undefined,
  stopped: string | null,
): ChatPendingTask | undefined {
  return stopped ? removePendingChatTask(pending, stopped) : pending;
}
