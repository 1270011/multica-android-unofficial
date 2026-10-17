/**
 * Agents and squads, read-only. Replaces the "coming soon" placeholder under More → Agents.
 *
 * - Agents: avatar with presence dot, status (working / queued / online /
 *   unstable / offline / no runtime), runtime and the last finished run.
 *   Archived agents are not listed (web hides them by default too).
 * - Squads: name, member count and preview; tap opens the squad detail.
 *
 * Creating or editing agents and squads stays on the web.
 */
import { useMemo, useState } from "react";
import { FlatList, Pressable, View } from "react-native";
import { router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import type { Agent, AgentTask, Squad } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { ActorAvatar } from "@/components/ui/actor-avatar";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { SegmentedPills } from "@/components/ui/segmented-pills";
import { agentListOptions } from "@/data/queries/agents";
import { runtimeListOptions } from "@/data/queries/runtimes";
import { squadListOptions } from "@/data/queries/squads";
import { agentTaskSnapshotOptions } from "@/data/queries/agent-task-snapshot";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useWorkspacePresenceMap } from "@/lib/use-agent-presence";
import {
  agentRuntimeLabel,
  agentStatus,
  type AgentStatus,
  lastRunByAgent,
  visibleAgents,
} from "@/lib/agent-overview";
import {
  useAgentStatusText,
  useLastRunText,
  useRuntimeText,
} from "@/components/agents/agent-texts";
import { guardedRefresh } from "@/lib/refresh-guard";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

type Tab = "agents" | "squads";

export default function AgentsPage() {
  const { t } = useT("workspace");
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const wsSlug = useWorkspaceStore((s) => s.currentWorkspaceSlug);
  const [tab, setTab] = useState<Tab>("agents");

  const agents = useQuery(agentListOptions(wsId));
  const runtimes = useQuery(runtimeListOptions(wsId));
  const snapshot = useQuery(agentTaskSnapshotOptions(wsId));
  const squads = useQuery({ ...squadListOptions(wsId), enabled: !!wsId && tab === "squads" });
  const { byAgent } = useWorkspacePresenceMap(wsId);

  const rows = useMemo(() => visibleAgents(agents.data ?? []), [agents.data]);
  const lastRuns = useMemo(() => lastRunByAgent(snapshot.data ?? []), [snapshot.data]);
  const squadRows = useMemo(
    () => (squads.data ?? []).filter((s) => !s.archived_at).sort((a, b) => a.name.localeCompare(b.name)),
    [squads.data],
  );

  const source = tab === "agents" ? agents : squads;
  const open = (path: string) => {
    if (wsSlug) router.push(`/${wsSlug}/${path}`);
  };

  return (
    <View className="flex-1 bg-background">
      <SegmentedPills
        items={[
          { value: "agents" as const, label: t("agent.tab_agents") },
          { value: "squads" as const, label: t("agent.tab_squads") },
        ]}
        value={tab}
        onChange={setTab}
      />
      {source.isLoading ? (
        <ListLoading />
      ) : source.error ? (
        <View className="px-4 gap-3 pt-4">
          <Text className="text-sm text-destructive">{t("agent.load_failed")}</Text>
          <Button variant="outline" onPress={() => source.refetch()}>
            <Text>{t("common:actions.retry")}</Text>
          </Button>
        </View>
      ) : tab === "agents" ? (
        <FlatList
          data={rows}
          keyExtractor={(a) => a.id}
          contentContainerClassName="pb-6"
          ItemSeparatorComponent={() => <View className="h-px bg-border ml-16" />}
          ListEmptyComponent={<Empty text={t("agent.empty")} />}
          renderItem={({ item }) => (
            <AgentRow
              agent={item}
              status={agentStatus(item, byAgent.get(item.id))}
              runtime={agentRuntimeLabel(item, runtimes.data ?? [])}
              lastRun={lastRuns.get(item.id)}
              onPress={() => open(`agent/${item.id}`)}
            />
          )}
          refreshing={agents.isRefetching}
          onRefresh={() =>
            guardedRefresh(() =>
              Promise.all([agents.refetch(), runtimes.refetch(), snapshot.refetch()]),
            )
          }
        />
      ) : (
        <FlatList
          data={squadRows}
          keyExtractor={(s) => s.id}
          contentContainerClassName="pb-6"
          ItemSeparatorComponent={() => <View className="h-px bg-border ml-16" />}
          ListEmptyComponent={<Empty text={t("agent.squads_empty")} />}
          renderItem={({ item }) => (
            <SquadRow squad={item} onPress={() => open(`squad/${item.id}`)} />
          )}
          refreshing={squads.isRefetching}
          onRefresh={() => guardedRefresh(() => squads.refetch())}
        />
      )}
    </View>
  );
}

function AgentRow({
  agent,
  status,
  runtime,
  lastRun,
  onPress,
}: {
  agent: Agent;
  status: AgentStatus;
  runtime: ReturnType<typeof agentRuntimeLabel>;
  lastRun: AgentTask | undefined;
  onPress: () => void;
}) {
  const statusText = useAgentStatusText()(status);
  const runtimeText = useRuntimeText()(runtime);
  const lastRunText = useLastRunText()(lastRun);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${agent.name}, ${statusText.text}, ${runtimeText}, ${lastRunText}`}
      testID="agent-row"
      className="flex-row items-center gap-3 px-4 py-3 min-h-12 active:bg-secondary"
    >
      <ActorAvatar type="agent" id={agent.id} size={36} showPresence />
      <View className="flex-1 gap-0.5">
        <Text className="text-sm font-medium text-foreground" numberOfLines={1}>
          {agent.name}
        </Text>
        <Text className={cn("text-xs", statusText.className)}>{statusText.text}</Text>
        <Text className="text-xs text-muted-foreground" numberOfLines={2}>
          {runtimeText} · {lastRunText}
        </Text>
      </View>
    </Pressable>
  );
}

function SquadRow({ squad, onPress }: { squad: Squad; onPress: () => void }) {
  const { t } = useT("workspace");
  const count = squad.member_count ?? squad.member_preview?.length ?? 0;
  const members = t("agent.member_count", { count });
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${squad.name}, ${members}`}
      testID="squad-row"
      className="flex-row items-center gap-3 px-4 py-3 min-h-12 active:bg-secondary"
    >
      <ActorAvatar type="squad" id={squad.id} name={squad.name} avatarUrl={squad.avatar_url} size={36} />
      <View className="flex-1 gap-0.5">
        <Text className="text-sm font-medium text-foreground" numberOfLines={1}>
          {squad.name}
        </Text>
        <Text className="text-xs text-muted-foreground" numberOfLines={2}>
          {squad.description ? `${members} · ${squad.description}` : members}
        </Text>
      </View>
    </Pressable>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <View className="items-center px-8 py-12">
      <Text className="text-sm text-muted-foreground text-center">{text}</Text>
    </View>
  );
}

function ListLoading() {
  return (
    <View className="px-4 pt-4 gap-4">
      {Array.from({ length: 5 }).map((_, i) => (
        <View key={i} className="flex-row gap-3">
          <Skeleton className="size-9 rounded-full" />
          <View className="flex-1 gap-2 pt-1">
            <Skeleton className="h-3.5 w-1/2" />
            <Skeleton className="h-3 w-3/4" />
          </View>
        </View>
      ))}
    </View>
  );
}
