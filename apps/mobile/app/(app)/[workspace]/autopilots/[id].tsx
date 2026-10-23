/**
 * Autopilot detail route on the phone. On a
 * tablet the Autopilots page shows the same component in its right pane
 * instead (W7 master-detail). After a delete the screen goes back to the
 * list.
 */
import { Stack, router, useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { AutopilotDetail } from "@/components/autopilots/autopilot-detail";
import { autopilotDetailOptions } from "@/data/queries/autopilots";
import { useWorkspaceStore } from "@/data/workspace-store";
import { autopilotsHref } from "@/lib/ai-team";
import { useT } from "@/lib/i18n";

export default function AutopilotDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useT("navigation");
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const wsSlug = useWorkspaceStore((s) => s.currentWorkspaceSlug);
  const { data } = useQuery(autopilotDetailOptions(wsId, id));

  const leave = () => {
    if (router.canGoBack()) router.back();
    else if (wsSlug) router.replace(autopilotsHref(wsSlug));
  };

  return (
    <>
      <Stack.Screen options={{ title: data?.autopilot.title ?? t("routes.autopilot") }} />
      <AutopilotDetail id={id} onDeleted={leave} />
    </>
  );
}
