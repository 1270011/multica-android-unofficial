/**
 * Chat session management: rename, pin, archive, queue.
 * Mirrors packages/core/chat/mutations.ts. Rename and pin are predictable
 * field patches on the active list (optimistic, rolled back on error).
 * Archive moves a row between the active and archived lists, so it waits
 * for the server and then refreshes both.
 */
import { type QueryClient, useMutation, useQueryClient } from "@tanstack/react-query";
import type { ChatMessage, ChatPendingTask, ChatSession } from "@multica/core/types";
import {
  prioritizePendingChatTask,
  removePendingChatTask,
} from "@multica/core/chat/pending";
import { api, ApiError } from "@/data/api";
import { pendingAfterSendNow, sendQueuedNow } from "@/lib/chat-queue";
import { showToast } from "@/lib/toast";
import { chatKeys } from "@/data/queries/chat";
import { useWorkspaceStore } from "@/data/workspace-store";
import { sortChatSessions } from "@/data/realtime/chat-ws-updaters";

// Lives with the realtime updaters, which re-sort on a pin event too.
export { sortChatSessions };

export function patchChatSession(
  sessions: ChatSession[] | undefined,
  sessionId: string,
  patch: Partial<ChatSession>,
): ChatSession[] | undefined {
  if (!sessions) return sessions;
  return sessions.map((s) => (s.id === sessionId ? { ...s, ...patch } : s));
}

function useOptimisticSessionPatch<V extends { sessionId: string }>(
  mutationFn: (vars: V) => Promise<ChatSession | null>,
  toPatch: (vars: V) => Partial<ChatSession>,
  resort: boolean,
) {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const key = chatKeys.sessions(wsId);

  return useMutation({
    mutationFn,
    onMutate: async (vars: V) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<ChatSession[]>(key);
      qc.setQueryData<ChatSession[]>(key, (old) => {
        const next = patchChatSession(old, vars.sessionId, toPatch(vars));
        return next && resort ? sortChatSessions(next) : next;
      });
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(key, ctx.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: key });
      // Rename/pin of an archived chat: the Archive view and a single-session
      // read show the title too.
      qc.invalidateQueries({ queryKey: chatKeys.archivedSessions(wsId) });
      qc.invalidateQueries({ queryKey: chatKeys.sessionPrefix(wsId) });
    },
  });
}

export function useRenameChatSession() {
  return useOptimisticSessionPatch(
    ({ sessionId, title }: { sessionId: string; title: string }) =>
      api.renameChatSession(sessionId, title),
    ({ title }) => ({ title }),
    false,
  );
}

export function useSetChatSessionPinned() {
  return useOptimisticSessionPatch(
    ({ sessionId, pinned }: { sessionId: string; pinned: boolean }) =>
      api.setChatSessionPinned(sessionId, pinned),
    ({ pinned }) => ({ pinned }),
    true,
  );
}

export function useSetChatSessionArchived() {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);

  return useMutation({
    mutationFn: ({ sessionId, archived }: { sessionId: string; archived: boolean }) =>
      api.setChatSessionArchived(sessionId, archived),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: chatKeys.sessions(wsId) });
      qc.invalidateQueries({ queryKey: chatKeys.archivedSessions(wsId) });
      // The open chat may be read on its own (archived).
      qc.invalidateQueries({ queryKey: chatKeys.sessionPrefix(wsId) });
    },
  });
}

/**
 * After a successful "clear": the queued messages leave the messages cache
 * and the queue leaves the pending task; the running head task stays.
 */
export function applyQueueCleared(qc: QueryClient, sessionId: string) {
  const key = chatKeys.pendingTask(sessionId);
  const queued = qc.getQueryData<ChatPendingTask>(key)?.queued_tasks ?? [];
  const messageIds = new Set(queued.flatMap((t) => (t.message_id ? [t.message_id] : [])));
  qc.setQueryData<ChatMessage[]>(chatKeys.messages(sessionId), (old) =>
    old?.filter((m) => !messageIds.has(m.id)),
  );
  qc.setQueryData<ChatPendingTask>(key, (old) =>
    queued.reduce<ChatPendingTask | undefined>(
      (current, t) => removePendingChatTask(current, t.task_id),
      old,
    ),
  );
}

/**
 * Chat queue actions, mirroring the web's
 * use-chat-task-actions.ts on mobile's caches:
 *
 * - `sendNow`: reorder optimistically, prioritize, stop the active run the
 *   server names (lib/chat-queue.ts `sendQueuedNow`). Roll the order back
 *   only if the prioritize itself failed. 409 = the run is not steerable
 *   (yet), shown as its own toast.
 * - `clear`: drop the queue; its messages leave the list at once and the
 *   messages are reloaded afterwards.
 *
 * Both refresh the pending task and the messages when done; the realtime
 * hook covers the `task:*` events that follow.
 */
export function useChatQueueActions(sessionId: string | null) {
  const qc = useQueryClient();

  const refresh = (id: string) => {
    qc.invalidateQueries({ queryKey: chatKeys.pendingTask(id) });
    qc.invalidateQueries({ queryKey: chatKeys.messages(id) });
  };

  const sendNow = async (taskId: string): Promise<boolean> => {
    if (!sessionId) return false;
    const id = sessionId;
    const key = chatKeys.pendingTask(id);
    await qc.cancelQueries({ queryKey: key });
    const snapshot = qc.getQueryData<ChatPendingTask>(key);
    qc.setQueryData<ChatPendingTask>(key, (old) => prioritizePendingChatTask(old, taskId));
    const result = await sendQueuedNow(id, taskId, {
      prioritize: (s, t) => api.prioritizeQueuedChatTask(s, t),
      cancel: (t) => api.cancelTaskById(t),
    });
    if (result.ok) {
      qc.setQueryData<ChatPendingTask | undefined>(key, (old) => pendingAfterSendNow(old, result.stopped));
    } else {
      if (!result.prioritized) qc.setQueryData(key, snapshot);
      const conflict = result.error instanceof ApiError && result.error.status === 409;
      showToast({ key: conflict ? "chat:queue.send_now_unavailable" : "chat:queue.failed" });
    }
    refresh(id);
    return result.ok;
  };

  const clear = async (): Promise<boolean> => {
    if (!sessionId) return false;
    const id = sessionId;
    const key = chatKeys.pendingTask(id);
    await qc.cancelQueries({ queryKey: key });
    try {
      await api.clearQueuedChatTasks(id);
      applyQueueCleared(qc, id);
      return true;
    } catch {
      showToast({ key: "chat:queue.failed" });
      return false;
    } finally {
      refresh(id);
    }
  };

  return { sendNow, clear };
}
