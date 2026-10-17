/**
 * Read-only subscriber list of an issue. You first, then
 * members, then agents, each by name. Pure, unit-tested.
 */
import type { IssueSubscriber } from "@multica/core/types";

export interface SubscriberRow {
  key: string;
  type: IssueSubscriber["user_type"];
  id: string;
  name: string;
  reason: IssueSubscriber["reason"];
  isMe: boolean;
}

export function subscriberRows(
  list: readonly IssueSubscriber[],
  meId: string | null,
  nameOf: (type: IssueSubscriber["user_type"], id: string) => string,
): SubscriberRow[] {
  return list
    .map((s) => ({
      key: `${s.user_type}:${s.user_id}`,
      type: s.user_type,
      id: s.user_id,
      name: nameOf(s.user_type, s.user_id),
      reason: s.reason,
      isMe: s.user_type === "member" && s.user_id === meId,
    }))
    .sort(
      (a, b) =>
        Number(b.isMe) - Number(a.isMe) ||
        (a.type === b.type ? 0 : a.type === "member" ? -1 : 1) ||
        a.name.localeCompare(b.name),
    );
}
