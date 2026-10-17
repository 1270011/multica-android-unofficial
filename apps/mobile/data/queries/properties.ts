/**
 * Custom issue property catalog (`GET /api/properties`). Values live on the
 * issue itself (`issue.properties`); this is only the definition list that
 * tells the detail screen which fields exist and how to render them.
 * Mirrors packages/core/properties/queries.ts.
 */
import { queryOptions } from "@tanstack/react-query";
import { api } from "@/data/api";

export const propertyKeys = {
  all: (wsId: string | null) => ["properties", wsId] as const,
  list: (wsId: string | null, includeArchived = false) =>
    [...propertyKeys.all(wsId), "list", includeArchived] as const,
};

/**
 * `includeArchived`: the issue detail needs archived definitions too, so a
 * value on an archived property stays visible and can be cleared (web uses
 * propertyListOptions(wsId, true) there; review #24).
 */
export const propertyListOptions = (wsId: string | null, includeArchived = false) =>
  queryOptions({
    queryKey: propertyKeys.list(wsId, includeArchived),
    queryFn: ({ signal }) => api.listProperties({ includeArchived, signal }),
    enabled: !!wsId,
  });
