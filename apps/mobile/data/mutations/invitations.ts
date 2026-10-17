/**
 * Accept / decline an invitation. Mirrors the web sidebar
 * (packages/views/layout/app-sidebar.tsx): accept refreshes the invitation
 * list and force-fetches the workspace list (staleTime 0) so the joined
 * workspace can be offered right away; every outcome of decline and a failed
 * accept refresh the invitations too ("invitation is not pending" means it
 * was concluded elsewhere — the stale row must drop).
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Invitation, Workspace } from "@multica/core/types";
import { api } from "@/data/api";
import { invitationKeys } from "@/data/queries/invitations";
import { workspaceListOptions } from "@/data/queries/workspaces";
import { acceptAndResolve } from "@/lib/invitations";

export function useAcceptInvitation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (invitation: Invitation): Promise<Workspace | null> =>
      acceptAndResolve(
        invitation,
        (id) => api.acceptInvitation(id),
        () => qc.fetchQuery({ ...workspaceListOptions(), staleTime: 0 }),
      ),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: invitationKeys.mine() });
      // Also after a failed list read inside acceptAndResolve.
      qc.invalidateQueries({ queryKey: workspaceListOptions().queryKey });
    },
  });
}

export function useDeclineInvitation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (invitation: Invitation) => api.declineInvitation(invitation.id),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: invitationKeys.mine() });
    },
  });
}
