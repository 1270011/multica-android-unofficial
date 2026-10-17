import { queryOptions } from "@tanstack/react-query";
import { api } from "@/data/api";

export const squadKeys = {
  all: (wsId: string | null) => ["squads", wsId] as const,
  detail: (wsId: string | null, id: string) =>
    [...squadKeys.all(wsId), "detail", id] as const,
  members: (wsId: string | null, id: string) =>
    [...squadKeys.all(wsId), "members", id] as const,
  memberStatus: (wsId: string | null, id: string) =>
    [...squadKeys.all(wsId), "member-status", id] as const,
};

export const squadListOptions = (wsId: string | null) =>
  queryOptions({
    queryKey: squadKeys.all(wsId),
    queryFn: ({ signal }) => api.listSquads({ signal }),
    enabled: !!wsId,
  });

export const squadDetailOptions = (wsId: string | null, id: string) =>
  queryOptions({
    queryKey: squadKeys.detail(wsId, id),
    queryFn: ({ signal }) => api.getSquad(id, { signal }),
    enabled: !!wsId && !!id,
  });

export const squadMembersOptions = (wsId: string | null, id: string) =>
  queryOptions({
    queryKey: squadKeys.members(wsId, id),
    queryFn: ({ signal }) => api.listSquadMembers(id, { signal }),
    enabled: !!wsId && !!id,
  });

export const squadMemberStatusOptions = (wsId: string | null, id: string) =>
  queryOptions({
    queryKey: squadKeys.memberStatus(wsId, id),
    queryFn: ({ signal }) => api.getSquadMemberStatus(id, { signal }),
    enabled: !!wsId && !!id,
  });
