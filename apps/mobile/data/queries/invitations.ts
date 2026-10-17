import { queryOptions } from "@tanstack/react-query";
import { api } from "@/data/api";

/**
 * Pending invitations of the signed-in user. Account-level,
 * not workspace-scoped: the same list shows in every workspace's switcher
 * and on the workspace selection after sign-in.
 *
 * Freshness: the server sends `invitation:*` to the invitee
 * (listeners.go, SendToUser), handled in use-invitations-realtime.ts while a
 * workspace is open. The workspace selection has no socket, so the query
 * refetches whenever a screen showing it mounts (`staleTime: 0`, overriding
 * the client's 60 s default).
 */
export const invitationKeys = {
  mine: () => ["invitations", "mine"] as const,
};

export const myInvitationsOptions = () =>
  queryOptions({
    queryKey: invitationKeys.mine(),
    queryFn: ({ signal }) => api.listMyInvitations({ signal }),
    staleTime: 0,
  });
