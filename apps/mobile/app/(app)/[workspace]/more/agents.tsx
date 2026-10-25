/**
 * Agents and squads, read-only. Replaces the "coming soon" placeholder under More → Agents.
 *
 * - Agents: avatar with presence dot, status (working / queued / online /
 *   unstable / offline / no runtime), runtime and the last finished run.
 *   Archived agents are not listed (web hides them by default too).
 * - Squads: name, member count and preview; tap opens the squad detail.
 * - Agents hidden in Settings › View are left out; the list ends
 *   with "2 hidden · Show", which unfolds them in this screen only, so their
 *   detail stays reachable.
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
import {
  useHiddenActors,
  useViewPrefsHydration,
} from "@/data/stores/view-prefs-store";
import { useWorkspacePresenceMap } from "@/lib/use-agent-presence";
import {
  agentRuntimeLabel,
  agentStatus,
  type AgentStatus,
  lastRunByAgent,
  splitHiddenAgents,
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

  useViewPrefsHydration(wsId);
  const hiddenActors = useHiddenActors(wsId);
  const [showHidden, setShowHidden] = useState(false);
  const { shown, hidden } = useMemo(
    () => splitHiddenAgents(visibleAgents(agents.data ?? []), hiddenActors.agents),
    [agents.data, hiddenActors.agents],
  );
  const hiddenIds = useMemo(() => new Set(hidden.map((a) => a.id)), [hidden]);
  const rows = showHidden ? [...shown, ...hidden] : shown;
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
          ListEmptyComponent={
            hidden.length === 0 ? <Empty text={t("agent.empty")} /> : null
          }
          ListFooterComponent={
            hidden.length > 0 ? (
              <HiddenFooter
                count={hidden.length}
                expanded={showHidden}
                onPress={() => setShowHidden((v) => !v)}
              />
            ) : null
          }
          renderItem={({ item }) => (
            <AgentRow
              agent={item}
              status={agentStatus(item, byAgent.get(item.id))}
              runtime={agentRuntimeLabel(item, runtimes.data ?? [])}
              lastRun={lastRuns.get(item.id)}
              hidden={hiddenIds.has(item.id)}
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
  hidden,
  onPress,
}: {
  agent: Agent;
  status: AgentStatus;
  runtime: ReturnType<typeof agentRuntimeLabel>;
  lastRun: AgentTask | undefined;
  /** Unfolded from the "n hidden" footer: dimmed and marked (W4). */
  hidden: boolean;
  onPress: () => void;
}) {
  const { t } = useT("workspace");
  const statusText = useAgentStatusText()(status);
  const runtimeText = useRuntimeText()(runtime);
  const lastRunText = useLastRunText()(lastRun);
  const hiddenNote = hidden ? `, ${t("agent.hidden_note")}` : "";
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${agent.name}${hiddenNote}, ${statusText.text}, ${runtimeText}, ${lastRunText}`}
      testID={hidden ? "agent-row-hidden" : "agent-row"}
      className={cn(
        "flex-row items-center gap-3 px-4 py-3 min-h-12 active:bg-secondary",
        hidden && "opacity-60",
      )}
    >
      <ActorAvatar type="agent" id={agent.id} size={36} showPresence />
      <View className="flex-1 gap-0.5">
        <Text
          className="text-sm font-medium text-foreground"
          numberOfLines={1}
          testID={hidden ? undefined : "agent-row-name"}
        >
          {agent.name}
          {hidden ? (
            <Text className="text-xs font-normal text-muted-foreground">
              {` · ${t("agent.hidden_note")}`}
            </Text>
          ) : null}
        </Text>
        <Text className={cn("text-xs", statusText.className)}>{statusText.text}</Text>
        <Text className="text-xs text-muted-foreground" numberOfLines={2}>
          {runtimeText} · {lastRunText}
        </Text>
      </View>
    </Pressable>
  );
}

/** "2 hidden · Show" / "2 hidden · Hide" at the end of the agent list. */
function HiddenFooter({
  count,
  expanded,
  onPress,
}: {
  count: number;
  expanded: boolean;
  onPress: () => void;
}) {
  const { t } = useT("workspace");
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ expanded }}
      testID="agents-hidden-footer"
      className="flex-row items-center px-4 py-3 min-h-12 active:bg-secondary"
    >
      <Text className="text-sm text-muted-foreground">
        {t("agent.hidden_count", { count })}
        {" · "}
        <Text className="text-sm font-medium text-primary">
          {t(expanded ? "agent.hidden_hide" : "agent.hidden_show")}
        </Text>
      </Text>
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
