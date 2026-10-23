/**
 * Autopilot mutations. Mirror the web actions in
 * packages/views/autopilots but bind to mobile's own ApiClient and
 * workspace store.
 *
 * Pause/resume flips optimistically in every cached list and
 * the detail and rolls back on error; "run now" and delete wait for the
 * server. Every mutation invalidates the whole `autopilotKeys.all(wsId)`
 * prefix afterwards.
 */
import { useMutation, useQueryClient, type QueryClient, type QueryKey } from "@tanstack/react-query";
import { api } from "@/data/api";
import type {
  AutopilotSettableStatus,
  MobileAutopilot,
  MobileAutopilotDetail,
  MobileAutopilotList,
} from "@/data/autopilot-schemas";
import { autopilotKeys } from "@/data/queries/autopilots";
import { useWorkspaceStore } from "@/data/workspace-store";

function invalidateAutopilots(qc: QueryClient, wsId: string | null) {
  return qc.invalidateQueries({ queryKey: autopilotKeys.all(wsId) });
}

function withStatus(a: MobileAutopilot, status: AutopilotSettableStatus): MobileAutopilot {
  // A manual pause/resume clears a system pause reason.
  return { ...a, status, raw_status: status, pause_reason: null };
}

/** Pure cache patch for the optimistic pause; exported for tests. */
export function setAutopilotStatusInList(
  list: MobileAutopilotList | undefined,
  id: string,
  status: AutopilotSettableStatus,
): MobileAutopilotList | undefined {
  if (!list) return list;
  return {
    ...list,
    autopilots: list.autopilots.map((a) => (a.id === id ? withStatus(a, status) : a)),
  };
}

/** Pure cache patch for the detail; exported for tests. */
export function setAutopilotStatusInDetail(
  detail: MobileAutopilotDetail | null | undefined,
  status: AutopilotSettableStatus,
): MobileAutopilotDetail | null | undefined {
  if (!detail) return detail;
  return { ...detail, autopilot: withStatus(detail.autopilot, status) };
}

export function useTriggerAutopilot() {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  return useMutation({
    mutationFn: (vars: { id: string; idempotencyKey?: string }) =>
      api.triggerAutopilot(vars.id, { idempotencyKey: vars.idempotencyKey }),
    onSettled: () => invalidateAutopilots(qc, wsId),
  });
}

type StatusSnapshot = { lists: [QueryKey, MobileAutopilotList | undefined][]; detail: unknown };

export function useSetAutopilotStatus() {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  return useMutation({
    mutationFn: (vars: { id: string; status: AutopilotSettableStatus }) =>
      api.setAutopilotStatus(vars.id, vars.status),
    onMutate: async (vars): Promise<StatusSnapshot> => {
      const listsKey = autopilotKeys.lists(wsId);
      const detailKey = autopilotKeys.detail(wsId, vars.id);
      await Promise.all([
        qc.cancelQueries({ queryKey: listsKey }),
        qc.cancelQueries({ queryKey: detailKey, exact: true }),
      ]);
      const snapshot: StatusSnapshot = {
        lists: qc.getQueriesData<MobileAutopilotList>({ queryKey: listsKey }),
        detail: qc.getQueryData(detailKey),
      };
      qc.setQueriesData<MobileAutopilotList>({ queryKey: listsKey }, (old) =>
        setAutopilotStatusInList(old, vars.id, vars.status),
      );
      qc.setQueryData<MobileAutopilotDetail | null>(detailKey, (old) =>
        setAutopilotStatusInDetail(old, vars.status),
      );
      return snapshot;
    },
    onError: (_err, vars, ctx) => {
      if (!ctx) return;
      for (const [key, data] of ctx.lists) qc.setQueryData(key, data);
      qc.setQueryData(autopilotKeys.detail(wsId, vars.id), ctx.detail);
    },
    onSettled: () => invalidateAutopilots(qc, wsId),
  });
}

export function useDeleteAutopilot() {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  return useMutation({
    mutationFn: (id: string) => api.deleteAutopilot(id),
    onSuccess: (_data, id) => {
      // Drop the detail first so the refetch below does not 404 on it.
      qc.removeQueries({ queryKey: autopilotKeys.detail(wsId, id) });
    },
    onSettled: () => invalidateAutopilots(qc, wsId),
  });
}
