/**
 * Double-state row that lives inside `IssueHeaderCard`. Pushes the
 * `issue/[id]/runs` formSheet route — the Stack-header
 * `<AgentHeaderBadge>` pushes the same route.
 *
 *   ≥1 active task        → [agent avatars] (pulse) Working           ›
 *   0 active, ≥1 past     → 🕓 Runs · N                                ›
 *   never run             → null (zero space)
 *
 * `reserveSpace` (chat footer): while the tasks load, an empty slot of the
 * row's height stands in, so the row does not push the last bubble up when
 * it appears (`lib/agent-activity.ts`).
 *
 * This row is the "discovery" surface (visible only when timeline isn't
 * scrolled). The badge is the "ambient" surface (always visible during
 * active tasks). One route, two entry points.
 */
import { useRef } from "react";
import { Pressable, View } from "react-native";
import { router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { Ionicons } from "@/components/ui/ionicons";
import { Text } from "@/components/ui/text";
import { AvatarStack, type StackActor } from "@/components/ui/avatar-stack";
import { PulseDot } from "@/components/ui/pulse-dot";
import {
  issueActiveTasksOptions,
  issueTasksOptions,
} from "@/data/queries/issues";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { useT } from "@/lib/i18n";
import {
  AGENT_ACTIVITY_ROW_HEIGHT,
  agentActivityState,
} from "@/lib/agent-activity";

interface Props {
  issueId: string;
  /** Hold the row's height while the tasks load (chat list footer). */
  reserveSpace?: boolean;
}

export function AgentActivityRow({ issueId, reserveSpace = false }: Props) {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const wsSlug = useWorkspaceStore((s) => s.currentWorkspaceSlug);
  const { colorScheme } = useColorScheme();
  const mutedFg = THEME[colorScheme].mutedForeground;

  const { data: activeTasks } = useQuery(
    issueActiveTasksOptions(wsId, issueId),
  );
  const { data: allTasks } = useQuery(issueTasksOptions(wsId, issueId));

  const reservedRef = useRef(false);
  const state = agentActivityState({
    activeTasks,
    allTasks,
    reserveSpace,
    reserved: reservedRef.current,
  });
  if (state.kind === "placeholder") {
    reservedRef.current = true;
    return (
      <View
        style={{ minHeight: AGENT_ACTIVITY_ROW_HEIGHT }}
        importantForAccessibility="no-hide-descendants"
        accessibilityElementsHidden
      />
    );
  }
  if (state.kind === "none") {
    return null;
  }

  return (
    <Pressable
      onPress={() => {
        if (!wsSlug) return;
        router.push({
          pathname: "/[workspace]/issue/[id]/runs",
          params: { workspace: wsSlug, id: issueId },
        });
      }}
      style={{ minHeight: AGENT_ACTIVITY_ROW_HEIGHT }}
      className="flex-row items-center gap-2 -mx-2 px-2 py-2 rounded-lg active:bg-secondary"
    >
      {state.kind === "active" ? (
        <ActiveContent
          actors={state.agentIds.map<StackActor>((id) => ({
            type: "agent",
            id,
          }))}
        />
      ) : (
        <IdleContent count={state.count} mutedFg={mutedFg} />
      )}
      <Ionicons name="chevron-forward" size={16} color={mutedFg} />
    </Pressable>
  );
}

function ActiveContent({ actors }: { actors: StackActor[] }) {
  const { t } = useT("projects");
  return (
    <View className="flex-1 flex-row items-center gap-2">
      <AvatarStack actors={actors} max={3} size={24} />
      <PulseDot />
      <Text className="text-sm font-medium text-foreground">
        {t("runs.working")}
      </Text>
    </View>
  );
}

function IdleContent({ count, mutedFg }: { count: number; mutedFg: string }) {
  const { t } = useT("projects");
  return (
    <View className="flex-1 flex-row items-center gap-2">
      <Ionicons name="time-outline" size={16} color={mutedFg} />
      <Text className="text-sm text-foreground">
        {t("runs.count", { count })}
      </Text>
    </View>
  );
}
