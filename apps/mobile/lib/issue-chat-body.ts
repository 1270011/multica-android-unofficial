/**
 * What the issue chat shows below its header. Pure, so the rule
 * "rows in the cache → the list in the first commit" has a test: the
 * skeleton and the error/empty states only stand in while there is nothing
 * to show. A background refetch (`fetching` with data) never brings the
 * skeleton back, which made the chat blank out on re-open before.
 */
export type ChatBody =
  | "gone"
  | "loading"
  | "error"
  | "timeline-loading"
  | "timeline-error"
  | "empty"
  | "list";

export interface ChatBodyInput {
  /** The issue answered 404/403. */
  notFound: boolean;
  /** Issue detail: no data yet and a first fetch running. */
  detailLoading: boolean;
  hasIssue: boolean;
  detailError: boolean;
  /** Timeline: no data yet and a first fetch running. */
  timelineLoading: boolean;
  timelineError: boolean;
  /** Timeline rows (server cache and local pending/failed ones) exist. */
  hasEntries: boolean;
  itemCount: number;
}

export function chatBody(s: ChatBodyInput): ChatBody {
  if (s.notFound) return "gone";
  if (!s.hasIssue) return s.detailLoading ? "loading" : "error";
  if (!s.hasEntries) {
    if (s.timelineLoading) return "timeline-loading";
    if (s.timelineError) return "timeline-error";
  }
  return s.itemCount === 0 ? "empty" : "list";
}
