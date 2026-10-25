/**
 * Agent detail, read-only: overview (status, runtime,
 * capacity, description) and the latest runs. Runs that belong to an issue
 * open that issue. Below the header, "Chat" and "New issue" start work with
 * this agent. Editing the agent (instructions, skills, runtime, access)
 * stays on the web.
 */
import { Pressable, ScrollView, View } from "react-native";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { Text } from "@/components/ui/text";
import { ActorAvatar } from "@/components/ui/actor-avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { RunRow } from "@/components/issue/run-row";
import { AgentHangStatusLine } from "@/components/agents/agent-hang-notice";
import { AgentActionRow } from "@/components/agents/agent-action-row";
import {
  useAgentStatusText,
  useRuntimeText,
} from "@/components/agents/agent-texts";
import {
  agentDetailOptions,
  agentListOptions,
  agentTasksOptions,
} from "@/data/queries/agents";
import { runtimeListOptions } from "@/data/queries/runtimes";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useAgentPresence } from "@/lib/use-agent-presence";
import { agentRuntimeLabel, agentStatus, runsSectionState } from "@/lib/agent-overview";
import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export default function AgentDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useT("workspace");
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const wsSlug = useWorkspaceStore((s) => s.currentWorkspaceSlug);
  // The list usually has the agent already; the detail call fills gaps
  // (deep link, archived agent).
  const { data: list } = useQuery(agentListOptions(wsId));
  const detail = useQuery(agentDetailOptions(wsId, id));
  const agent = detail.data ?? list?.find((a) => a.id === id);
  const { data: runtimes = [] } = useQuery(runtimeListOptions(wsId));
  const tasks = useQuery(agentTasksOptions(wsId, id));
  const runsState = runsSectionState({
    isLoading: tasks.isLoading,
    error: tasks.error,
    hasData: tasks.data !== undefined,
    count: tasks.data?.length ?? 0,
  });
  const presence = useAgentPresence(wsId, id);
  const statusText = useAgentStatusText();
  const runtimeText = useRuntimeText();

  if (!agent) {
    return (
      <View className="flex-1 bg-background px-4 pt-6 gap-3">
        <Stack.Screen options={{ title: t("agent.title") }} />
        {detail.isLoading ? (
          <Skeleton className="h-5 w-1/2" />
        ) : (
          <Text className="text-sm text-muted-foreground">{t("agent.not_found")}</Text>
        )}
      </View>
    );
  }

  const status = statusText(
    agentStatus(agent, presence === "loading" ? undefined : presence),
  );
  const capacity = agent.max_concurrent_tasks;

  return (
    <ScrollView className="flex-1 bg-background" contentContainerClassName="pb-8">
      <Stack.Screen options={{ title: agent.name }} />
      <View className="flex-row items-center gap-3 px-4 pt-4">
        <ActorAvatar type="agent" id={agent.id} size={48} showPresence />
        <View className="flex-1">
          <Text
            accessibilityRole="header"
            className="text-lg font-semibold text-foreground"
          >
            {agent.name}
          </Text>
          <Text className={cn("text-sm", status.className)}>{status.text}</Text>
        </View>
      </View>
      <AgentActionRow agent={agent} />
      {/* "Warum hängt mein Agent?": only when something needs attention. */}
      <AgentHangStatusLine agentId={agent.id} className="mx-4 mt-3" />

      <Section title={t("agent.overview")}>
        <Field label={t("agent.field_runtime")} value={runtimeText(agentRuntimeLabel(agent, runtimes))} />
        {capacity ? (
          <Field label={t("agent.field_capacity")} value={t("agent.capacity_value", { count: capacity })} />
        ) : null}
        {agent.archived_at ? (
          <Field label={t("agent.field_archived")} value={new Date(agent.archived_at).toLocaleDateString()} />
        ) : null}
        {agent.description ? (
          <Text className="text-sm text-foreground px-4 pt-2">{agent.description}</Text>
        ) : null}
      </Section>

      <Section title={t("agent.recent_runs")}>
        {runsState === "loading" ? (
          <View className="px-4 gap-2">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-2/3" />
          </View>
        ) : runsState === "forbidden" || runsState === "error" ? (
          <View className="px-4 gap-2 items-start" testID="agent-runs-error">
            <Text className="text-sm text-destructive">
              {t(runsState === "forbidden" ? "agent.runs_forbidden" : "agent.runs_error")}
            </Text>
            {runsState === "error" ? (
              <Button variant="outline" size="sm" className="min-h-12" onPress={() => void tasks.refetch()}>
                <Text>{t("common:actions.retry")}</Text>
              </Button>
            ) : null}
          </View>
        ) : runsState === "empty" ? (
          <Text className="px-4 text-sm text-muted-foreground">{t("agent.no_runs")}</Text>
        ) : (
          (tasks.data ?? []).map((task) => (
            <Pressable
              key={task.id}
              disabled={!task.issue_id}
              onPress={() => {
                if (wsSlug && task.issue_id) router.push(`/${wsSlug}/issue/${task.issue_id}`);
              }}
              accessibilityRole={task.issue_id ? "button" : undefined}
              className="px-4 active:bg-secondary"
            >
              <RunRow task={task} />
            </Pressable>
          ))
        )}
      </Section>
    </ScrollView>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View className="pt-5 gap-1">
      <Text
        accessibilityRole="header"
        className="px-4 pb-1 text-xs uppercase tracking-wider text-muted-foreground font-medium"
      >
        {title}
      </Text>
      {children}
    </View>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row flex-wrap gap-x-3 px-4 py-1.5" accessible accessibilityLabel={`${label}: ${value}`}>
      <Text className="text-sm text-muted-foreground min-w-24">{label}</Text>
      <Text className="flex-1 text-sm text-foreground">{value}</Text>
    </View>
  );
}
