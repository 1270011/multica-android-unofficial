/**
 * Runs of one autopilot. Opened by "Läufe
 * ansehen" in the row menu and in the detail; read-only.
 */
import { Stack, useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { AutopilotRuns } from "@/components/autopilots/autopilot-runs";
import { autopilotDetailOptions } from "@/data/queries/autopilots";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useT } from "@/lib/i18n";

export default function AutopilotRunsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useT("navigation");
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const { data } = useQuery(autopilotDetailOptions(wsId, id));
  const title = data?.autopilot.title;

  return (
    <>
      <Stack.Screen
        options={{ title: title ? t("routes.autopilot_runs_of", { title }) : t("routes.autopilot_runs") }}
      />
      <AutopilotRuns id={id} />
    </>
  );
}
