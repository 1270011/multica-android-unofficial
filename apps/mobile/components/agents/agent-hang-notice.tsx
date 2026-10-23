/**
 * "Warum hängt mein Agent?" on the agent and issue detail. Read-only; live on the 30 s visible tick
 * (`useVisibleNow`) over the cached agent/runtime/snapshot queries, no extra
 * polling. Placement rules live in `lib/agent-hang-notice.ts`.
 *
 * - `AgentHangStatusLine`: status line under the agent header, only when
 *   something needs attention, with "Runtime ansehen".
 * - `IssueAgentHangBanner`: banner under the issue head when an active task
 *   of this issue waits on an offline runtime.
 * Texts wrap (no fixed heights), so 200 % font scale only grows the rows.
 */
import { useMemo } from "react";
import { Pressable, View } from "react-native";
import { router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { Text } from "@/components/ui/text";
import { agentListOptions } from "@/data/queries/agents";
import { agentTaskSnapshotOptions } from "@/data/queries/agent-task-snapshot";
import { issueActiveTasksOptions } from "@/data/queries/issues";
import { runtimeListOptions } from "@/data/queries/runtimes";
import { useWorkspaceStore } from "@/data/workspace-store";
import { describeAgentHangState, type AgentHangState, type AgentHangTone } from "@/lib/agent-hang-state";
import {
  agentHangStateFor,
  findStuckIssueAgent,
  hangRuntimeLinkId,
  showAgentHangLine,
} from "@/lib/agent-hang-notice";
import { formatOfflineFor } from "@/lib/autopilot-detail";
import { useT } from "@/lib/i18n";
import { useVisibleNow } from "@/lib/use-visible-tick";
import { cn } from "@/lib/utils";

export const HANG_TONE_DOT: Record<AgentHangTone, string> = {
  ok: "bg-success",
  warning: "bg-warning",
  danger: "bg-destructive",
  muted: "bg-muted-foreground/40",
};

const TONE_BOX: Record<AgentHangTone, string> = {
  ok: "bg-secondary",
  warning: "bg-warning/10",
  danger: "bg-destructive/10",
  muted: "bg-secondary",
};

function RuntimeLink({ runtimeId, testID }: { runtimeId: string; testID: string }) {
  const { t } = useT("workspace");
  const wsSlug = useWorkspaceStore((s) => s.currentWorkspaceSlug);
  if (!wsSlug) return null;
  return (
    <Pressable
      onPress={() => router.push(`/${wsSlug}/runtimes/${runtimeId}`)}
      accessibilityRole="link"
      hitSlop={8}
      className="self-start min-h-12 justify-center"
      testID={testID}
    >
      <Text className="text-sm text-primary font-medium">{t("agent_hang.view_runtime")}</Text>
    </Pressable>
  );
}

function HangBox({
  state,
  title,
  hint,
  testID,
  className,
}: {
  state: AgentHangState;
  title: string;
  hint: string | null;
  testID: string;
  className?: string;
}) {
  const runtimeId = hangRuntimeLinkId(state);
  return (
    <View className={cn("rounded-md px-3 py-2 gap-1", TONE_BOX[state.tone], className)} testID={testID}>
      <View className="flex-row items-center gap-1.5">
        <View className={cn("size-2 rounded-full", HANG_TONE_DOT[state.tone])} />
        <Text
          className={cn(
            "flex-1 text-sm",
            state.tone === "danger" ? "text-destructive font-medium" : "text-foreground",
          )}
        >
          {title}
        </Text>
      </View>
      {hint ? <Text className="text-xs text-muted-foreground">{hint}</Text> : null}
      {runtimeId ? <RuntimeLink runtimeId={runtimeId} testID={`${testID}-runtime-link`} /> : null}
    </View>
  );
}

export function AgentHangStatusLine({ agentId, className }: { agentId: string; className?: string }) {
  const { t } = useT("workspace");
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const agents = useQuery(agentListOptions(wsId));
  const runtimes = useQuery(runtimeListOptions(wsId));
  const snapshot = useQuery(agentTaskSnapshotOptions(wsId));
  const now = useVisibleNow();

  const state = useMemo(
    () =>
      agentHangStateFor({
        agentId,
        agents: agents.data,
        runtimes: runtimes.data,
        snapshot: snapshot.data,
        now,
      }),
    [agentId, agents.data, runtimes.data, snapshot.data, now],
  );
  if (!state || !showAgentHangLine(state)) return null;
  const text = describeAgentHangState(state, t, (ms) => formatOfflineFor(ms, t));
  return (
    <HangBox
      state={state}
      title={text.label}
      hint={text.hint}
      testID={`agent-hang-${state.kind}`}
      className={className}
    />
  );
}

export function IssueAgentHangBanner({ issueId }: { issueId: string }) {
  const { t } = useT("workspace");
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const activeTasks = useQuery(issueActiveTasksOptions(wsId, issueId));
  const agents = useQuery(agentListOptions(wsId));
  const runtimes = useQuery(runtimeListOptions(wsId));
  const now = useVisibleNow();

  const stuck = useMemo(
    () =>
      findStuckIssueAgent({
        activeTasks: activeTasks.data ?? [],
        agents: agents.data,
        runtimes: runtimes.data,
        now,
      }),
    [activeTasks.data, agents.data, runtimes.data, now],
  );
  if (!stuck) return null;
  const text = describeAgentHangState(stuck.state, t, (ms) => formatOfflineFor(ms, t));
  return (
    <HangBox
      state={stuck.state}
      title={t("agent_hang.with_agent", { name: stuck.agent.name, label: text.label })}
      hint={text.hint}
      testID="issue-agent-hang"
    />
  );
}
