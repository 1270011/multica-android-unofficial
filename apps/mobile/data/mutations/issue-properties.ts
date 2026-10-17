/**
 * Set / clear one custom property value on an issue (UX §6 E). Mirrors
 * packages/core/properties/mutations.ts on mobile's detail cache:
 *
 * - Optimistic merge into `issue.properties` (never replace the whole bag).
 * - Writes for the same issue share a mutation `scope`, so full-bag
 *   responses cannot land out of order.
 * - The server's returned bag is authoritative (unless it is the parse
 *   fallback); settle refreshes the detail
 *   and the catalog (usage counts).
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  Issue,
  IssuePropertiesResponse,
  IssuePropertyValue,
  IssuePropertyValues,
} from "@multica/core/types";
import { api } from "@/data/api";
import { issueKeys } from "@/data/queries/issues";
import { propertyKeys } from "@/data/queries/properties";
import { useWorkspaceStore } from "@/data/workspace-store";
import { showToast } from "@/lib/toast";

/** Merge one property change into a bag; `undefined` clears the key. */
export function mergePropertyValue(
  bag: IssuePropertyValues | undefined,
  propertyId: string,
  value: IssuePropertyValue | undefined,
): IssuePropertyValues {
  const next = { ...(bag ?? {}) };
  if (value === undefined) delete next[propertyId];
  else next[propertyId] = value;
  return next;
}

/**
 * Server bag after a write. A response without `issue_revision` is the
 * parse fallback (`{ properties: {} }`), not a real bag: keep the cache.
 */
export function applyPropertiesResponse(
  current: Issue | undefined,
  res: IssuePropertiesResponse,
): Issue | undefined {
  if (!current || res.issue_revision === undefined) return current;
  return { ...current, properties: res.properties };
}

type Vars = { propertyId: string; value?: IssuePropertyValue };

export function useIssuePropertyMutation(issueId: string) {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const key = issueKeys.detail(wsId, issueId);

  return useMutation({
    scope: { id: `issue-properties-${issueId}` },
    mutationFn: ({ propertyId, value }: Vars) =>
      value === undefined
        ? api.unsetIssueProperty(issueId, propertyId)
        : api.setIssueProperty(issueId, propertyId, value),
    onMutate: async ({ propertyId, value }) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<Issue>(key);
      if (prev) {
        qc.setQueryData<Issue>(key, {
          ...prev,
          properties: mergePropertyValue(prev.properties, propertyId, value),
        });
      }
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(key, ctx.prev);
      showToast({ key: "issues:errors.update_failed" });
    },
    onSuccess: (res) => {
      qc.setQueryData<Issue>(key, (current) => applyPropertiesResponse(current, res));
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: key });
      qc.invalidateQueries({ queryKey: propertyKeys.all(wsId) });
    },
  });
}
