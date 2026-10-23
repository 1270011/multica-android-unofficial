import { useQuery } from "@tanstack/react-query";
import { autopilotsProbeOptions } from "@/data/queries/features";
import { runtimeListOptions } from "@/data/queries/runtimes";
import { featureState, type FeatureState } from "@/lib/ai-team";

/** Feature gate of the "AI Team" entries (lib/ai-team.ts). */
export function useAiTeamGates(wsId: string | null): {
  autopilots: FeatureState;
  runtimes: FeatureState;
} {
  const autopilots = useQuery(autopilotsProbeOptions(wsId));
  const runtimes = useQuery(runtimeListOptions(wsId));
  return { autopilots: featureState(autopilots), runtimes: featureState(runtimes) };
}
