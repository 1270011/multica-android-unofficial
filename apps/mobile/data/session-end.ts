/**
 * Everything the signed-in account left in memory and in app files, cleared
 * on every way a session ends: logout
 * from Settings or the workspace selection, a 401, a server change or reset.
 * `logout()` and the 401 launch check call it, so no caller can forget a
 * part. Without it the next account saw cached data of the old one for up
 * to 10 min and could "Retry" its failed comments under its own name.
 *
 * Token, notification session, drafts and filters have their own teardown
 * (secure-storage, auth-store); this covers the rest:
 *   - React Query: query and mutation cache (`QueryClient.clear()`)
 *   - failed comments (text + retry payload), last-viewed markers, the
 *     recently viewed issues behind the `@` suggestions
 *   - the saved route for the M4 restore (`reco-last-route.json`)
 *   - the in-memory Markdown split cache
 *   - the encrypted on-device timeline cache and its key (C7)
 *   - the @-mention frequency of every workspace; the
 *     device sort mode in view-prefs-store stays
 */
import { queryClient } from "./query-client";
import { useFailedCommentsStore } from "./stores/failed-comments-store";
import { useLastViewedStore } from "./stores/last-viewed-store";
import { useViewedIssuesStore } from "./viewed-issues-store";
import { forgetRememberedRoute } from "@/lib/route-restore";
import { clearMarkdownSegmentCache } from "@/lib/markdown/segment-cache";
import { clearTimelineCache } from "./timeline-cache";
import { clearAllMentionUsage } from "@/lib/mention-usage";

export function clearSessionData(): void {
  // First: no throttled cache write may land after this point.
  clearTimelineCache();
  // Running fetches would otherwise write the old account's answers back.
  void queryClient.cancelQueries();
  queryClient.clear();
  useFailedCommentsStore.setState({ failed: {} });
  useLastViewedStore.setState({ lastViewed: {} });
  useViewedIssuesStore.setState({ byWorkspace: {} });
  forgetRememberedRoute();
  clearMarkdownSegmentCache();
  clearAllMentionUsage();
}
