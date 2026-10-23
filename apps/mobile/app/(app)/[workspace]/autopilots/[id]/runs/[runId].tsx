/**
 * Run sheet of an autopilot run (formSheet).
 */
import { useLocalSearchParams } from "expo-router";
import { AutopilotRunSheet } from "@/components/autopilots/autopilot-run-sheet";

export default function AutopilotRunRoute() {
  const { id, runId } = useLocalSearchParams<{ id: string; runId: string }>();
  return <AutopilotRunSheet id={id} runId={runId} />;
}
