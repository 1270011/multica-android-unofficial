/**
 * Invitations realtime. The server sends
 * `invitation:created` / `revoked` to the invitee and `accepted` / `declined`
 * to the acting invitee (server/cmd/server/listeners.go, SendToUser), so the
 * pending list in the switcher and the dot on the workspace card follow
 * without reopening. An invitation accepted on another device also adds a
 * workspace, so the workspace list refreshes on `accepted` too. Reconnect
 * refetches in case events were missed.
 *
 * Mounted in `RealtimeSubscriptions` (workspace layout). The workspace
 * selection screen has no socket; it refetches on mount instead.
 */
import { useQueryClient } from "@tanstack/react-query";
import { invitationKeys } from "@/data/queries/invitations";
import { workspaceListOptions } from "@/data/queries/workspaces";
import { useWSSubscriptions } from "@/lib/use-ws-subscriptions";

export function useInvitationsRealtime() {
  const qc = useQueryClient();

  useWSSubscriptions(
    (ws) => {
      const refreshInvitations = () =>
        qc.invalidateQueries({ queryKey: invitationKeys.mine() });
      const refreshAll = () => {
        refreshInvitations();
        qc.invalidateQueries({ queryKey: workspaceListOptions().queryKey });
      };
      return [
        ws.on("invitation:created", refreshInvitations),
        ws.on("invitation:revoked", refreshInvitations),
        ws.on("invitation:declined", refreshInvitations),
        ws.on("invitation:accepted", refreshAll),
        ws.onReconnect(refreshInvitations),
      ];
    },
    [qc],
  );
}
