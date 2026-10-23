/**
 * Former workspace Issues page. Since 2.0 the whole workspace is the tab "All" of My Issues, and "Issues" is no
 * longer in the More menu. The route stays as a redirect so old deep links
 * and a restored route (lib/route-restore.ts) do not end on a blank screen.
 */
import { Redirect, useLocalSearchParams } from "expo-router";

export default function LegacyIssuesRedirect() {
  const { workspace } = useLocalSearchParams<{ workspace: string }>();
  return (
    <Redirect
      href={{ pathname: "/[workspace]/my-issues", params: { workspace, tab: "all" } }}
    />
  );
}
