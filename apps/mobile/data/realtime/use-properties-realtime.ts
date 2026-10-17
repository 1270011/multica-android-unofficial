/**
 * Workspace-wide realtime for custom properties (review #24;
 * web use-realtime-sync.ts "issue_properties:changed" / "property:*"):
 *
 * issue_properties:changed — patch the issue detail's value bag (only when
 *                            not older than the cache) and refetch the
 *                            catalog, whose usage counts moved.
 * property:created/updated — definitions changed: refetch the catalog.
 * onReconnect              — refetch the catalog (missed definition
 *                            changes); issue details refetch on their own.
 */
import { useQueryClient } from "@tanstack/react-query";
import { propertyKeys } from "@/data/queries/properties";
import { useWSSubscriptions } from "@/lib/use-ws-subscriptions";
import { patchIssueProperties } from "./issue-ws-updaters";

export function usePropertiesRealtime() {
  const qc = useQueryClient();
  useWSSubscriptions(
    (ws, wsId) => {
      const refetchCatalog = () => qc.invalidateQueries({ queryKey: propertyKeys.all(wsId) });
      return [
        ws.on("issue_properties:changed", (payload) => {
          if (!payload.issue_id) return;
          patchIssueProperties(qc, wsId, payload.issue_id, payload.properties ?? {}, payload.issue_revision);
          refetchCatalog();
        }),
        ws.on("property:created", refetchCatalog),
        ws.on("property:updated", refetchCatalog),
        ws.onReconnect(refetchCatalog),
      ];
    },
    [qc],
  );
}
