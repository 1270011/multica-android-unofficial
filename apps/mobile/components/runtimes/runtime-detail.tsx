/**
 * Runtime detail, read-only.
 * Used by the `runtimes/[id]` route on phones and in the right pane of the
 * runtime list from 600 dp (R2 MasterDetail).
 *
 * Status line → "Warum hängt es?" card (only when action is needed, see
 * `runtimeStuckReason`) → agents → queue (links to the issue) → device and
 * owner → activity bars (GET /api/runtimes/{id}/activity, one TalkBack
 * sentence instead of 24 values). Everything except the activity comes from
 * caches the realtime channel keeps fresh (runtimes, agents, task snapshot).
 */
import { useMemo } from "react";
import { Pressable, RefreshControl, ScrollView, View } from "react-native";
import { router } from "expo-router";
import { useQueries, useQuery } from "@tanstack/react-query";
import { deriveRuntimeHealth } from "@multica/core/runtimes/derive-health";
import type { AgentTask, RuntimeDevice } from "@multica/core/types";
import { ActorAvatar } from "@/components/ui/actor-avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { SymbolIcon } from "@/components/ui/symbol-icon";
import { Text } from "@/components/ui/text";
import { agentTaskSnapshotOptions } from "@/data/queries/agent-task-snapshot";
import { agentListOptions } from "@/data/queries/agents";
import { issueDetailOptions } from "@/data/queries/issues";
import { memberListOptions } from "@/data/queries/members";
import { runtimeActivityOptions, runtimeListOptions } from "@/data/queries/runtimes";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useT } from "@/lib/i18n";
import { guardedRefresh } from "@/lib/refresh-guard";
import {
  activityBars,
  activitySummaryText,
  queueWaitText,
  runtimeAgentRows,
  runtimeAgentWorkText,
  runtimeStatusLine,
  runtimeStuckReason,
  runtimeStuckText,
} from "@/lib/runtime-detail";
import { runtimeHealthTone } from "@/lib/runtime-list-texts";
import { runtimeQueue, splitRuntimeName } from "@/lib/runtime-machines";
import { THEME } from "@/lib/theme";
import { useColorScheme } from "@/lib/use-color-scheme";
import { useVisibleNow } from "@/lib/use-visible-tick";
import { cn } from "@/lib/utils";

/** Queue rows shown before "und n weitere" (each one may load its issue). */
const QUEUE_LIMIT = 10;

const TONE_DOT = { success: "bg-success", warning: "bg-warning", muted: "bg-muted-foreground/40" };
const TONE_TEXT = { success: "text-success", warning: "text-warning", muted: "text-muted-foreground" };

function viewerTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/** "claude · devbox-a"; a custom name wins, like the list. */
export function runtimeTitle(runtime: RuntimeDevice | undefined, fallback: string): string {
  const custom = runtime?.custom_name?.trim();
  if (custom) return custom;
  if (!runtime?.name) return fallback;
  const { base, hostname } = splitRuntimeName(runtime.name);
  return hostname ? `${base} · ${hostname}` : runtime.name;
}

export function RuntimeDetail({ runtimeId }: { runtimeId: string }) {
  const { t } = useT("workspace");
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const runtimes = useQuery(runtimeListOptions(wsId));
  const agents = useQuery(agentListOptions(wsId));
  const snapshot = useQuery(agentTaskSnapshotOptions(wsId));
  const members = useQuery(memberListOptions(wsId));
  const tz = useMemo(viewerTimeZone, []);
  const activity = useQuery(runtimeActivityOptions(wsId, runtimeId, tz));
  const now = useVisibleNow();

  const runtime = runtimes.data?.find((r) => r.id === runtimeId);
  const agentRows = useMemo(
    () => runtimeAgentRows(runtimeId, agents.data ?? [], snapshot.data ?? []),
    [runtimeId, agents.data, snapshot.data],
  );
  const queue = useMemo(
    () => runtimeQueue(runtimeId, agents.data ?? [], snapshot.data ?? []),
    [runtimeId, agents.data, snapshot.data],
  );

  if (!runtime) {
    return (
      <View className="flex-1 bg-background px-4 pt-6 gap-3" testID="runtime-detail">
        {runtimes.isLoading ? (
          <Skeleton className="h-5 w-1/2" />
        ) : (
          <Text className="text-sm text-muted-foreground" testID="runtime-detail-not-found">
            {t("runtime_detail.not_found")}
          </Text>
        )}
      </View>
    );
  }

  const name = runtimeTitle(runtime, t("runtime_list.title"));
  const health = deriveRuntimeHealth(runtime, now);
  const tone = runtimeHealthTone(health);
  const running = agentRows.reduce((n, r) => n + r.runningCount, 0);
  const reason = runtimeStuckReason({
    health,
    lastSeenAt: runtime.last_seen_at,
    queue,
    running,
    now,
  });
  const statusLine = runtimeStatusLine(health, runtime.last_seen_at, now);
  const owner = runtime.owner_id
    ? members.data?.find((m) => m.user_id === runtime.owner_id)?.name ?? t("runtime_detail.unknown")
    : t("runtime_detail.unknown");
  const cli = runtime.metadata?.cli_version;
  const version = typeof cli === "string" ? cli.trim() : "";

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerClassName="pb-8"
      testID="runtime-detail"
      refreshControl={
        <RefreshControl
          refreshing={runtimes.isRefetching || activity.isRefetching}
          onRefresh={() =>
            guardedRefresh(() =>
              Promise.all([runtimes.refetch(), agents.refetch(), snapshot.refetch(), activity.refetch()]),
            )
          }
        />
      }
    >
      <View
        className="flex-row items-center gap-3 px-4 pt-4"
        accessible
        accessibilityLabel={`${name}, ${statusLine}`}
        testID="runtime-detail-status"
      >
        <View className={cn("size-3 rounded-full", TONE_DOT[tone])} />
        <View className="flex-1">
          <Text accessibilityRole="header" className="text-lg font-semibold text-foreground">
            {name}
          </Text>
          <Text className={cn("text-sm", TONE_TEXT[tone])}>{statusLine}</Text>
        </View>
      </View>

      {reason ? (
        <View
          accessible
          accessibilityLabel={`${t("runtime_detail.stuck_title")}. ${runtimeStuckText(reason, name, now)}`}
          testID="runtime-stuck-card"
          className="mx-4 mt-4 gap-1 rounded-md border border-warning/40 bg-warning/10 px-3 py-2.5"
        >
          <Text className="text-sm font-semibold text-foreground">{t("runtime_detail.stuck_title")}</Text>
          <Text className="text-sm text-foreground">{runtimeStuckText(reason, name, now)}</Text>
        </View>
      ) : null}

      <Section title={t("runtime_detail.agents_title", { count: agentRows.length })} testID="runtime-agents">
        {agentRows.length === 0 ? (
          <Text className="px-4 text-sm text-muted-foreground">{t("runtime_detail.agents_empty")}</Text>
        ) : (
          agentRows.map((row) => (
            <AgentRow
              key={row.agent.id}
              id={row.agent.id}
              name={row.agent.name}
              work={runtimeAgentWorkText(row)}
            />
          ))
        )}
      </Section>

      <Section title={t("runtime_detail.queue_title", { count: queue.length })} testID="runtime-queue">
        {queue.length === 0 ? (
          <Text className="px-4 text-sm text-muted-foreground" testID="runtime-queue-empty">
            {t("runtime_detail.queue_empty")}
          </Text>
        ) : (
          <QueueList queue={queue} now={now} />
        )}
      </Section>

      <Section title={t("runtime_detail.info_title")}>
        <Field label={t("runtime_detail.field_device")} value={runtime.device_info || t("runtime_detail.unknown")} />
        <Field
          label={t("runtime_detail.field_daemon")}
          value={version ? `${runtime.runtime_mode} · ${version}` : runtime.runtime_mode}
        />
        {runtime.provider ? <Field label={t("runtime_detail.field_provider")} value={runtime.provider} /> : null}
        <Field label={t("runtime_detail.field_owner")} value={owner} />
        <Field
          label={t("runtime_detail.field_visibility")}
          value={t(
            runtime.visibility === "public"
              ? "runtime_detail.visibility_public"
              : "runtime_detail.visibility_private",
          )}
        />
      </Section>

      <Section title={t("runtime_detail.activity_title")}>
        {activity.isLoading ? (
          <View className="px-4">
            <Skeleton className="h-16 w-full" />
          </View>
        ) : activity.error ? (
          <Text className="px-4 text-sm text-destructive" testID="runtime-activity-error">
            {t("runtime_detail.activity_failed")}
          </Text>
        ) : (
          <ActivityBars bars={activityBars(activity.data ?? [])} />
        )}
      </Section>
    </ScrollView>
  );
}

function AgentRow({ id, name, work }: { id: string; name: string; work: string }) {
  const wsSlug = useWorkspaceStore((s) => s.currentWorkspaceSlug);
  const { colorScheme } = useColorScheme();
  return (
    <Pressable
      onPress={() => {
        if (wsSlug) router.push(`/${wsSlug}/agent/${id}`);
      }}
      accessibilityRole="button"
      accessibilityLabel={`${name}, ${work}`}
      testID="runtime-agent-row"
      className="flex-row items-center gap-3 px-4 py-2 min-h-12 active:bg-secondary"
    >
      <ActorAvatar type="agent" id={id} size={28} showPresence />
      <View className="flex-1 flex-row flex-wrap items-center gap-x-2">
        <Text className="text-sm font-medium text-foreground">{name}</Text>
        <Text className="text-xs text-muted-foreground">{work}</Text>
      </View>
      <SymbolIcon name="chevron.right" size={14} color={THEME[colorScheme].mutedForeground} />
    </Pressable>
  );
}

function QueueList({ queue, now }: { queue: AgentTask[]; now: number }) {
  const { t } = useT("workspace");
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const shown = queue.slice(0, QUEUE_LIMIT);
  // Identifier and title of each linked issue; usually already cached from
  // the board or inbox.
  const issueIds = [...new Set(shown.map((task) => task.issue_id).filter(Boolean))];
  const issues = useQueries({
    queries: issueIds.map((id) => ({ ...issueDetailOptions(wsId, id), staleTime: 60_000 })),
  });
  const byId = new Map(issueIds.map((id, i) => [id, issues[i]?.data]));
  const rest = queue.length - shown.length;
  return (
    <View>
      {shown.map((task) => (
        <QueueRow
          key={task.id}
          task={task}
          issueText={(() => {
            if (!task.issue_id) return t("runtime_detail.queue_no_issue");
            const issue = byId.get(task.issue_id);
            return issue ? `${issue.identifier} · ${issue.title}` : task.trigger_summary?.trim() || "…";
          })()}
          wait={queueWaitText(task, now)}
        />
      ))}
      {rest > 0 ? (
        <Text className="px-4 py-2 text-sm text-muted-foreground">
          {t("runtime_detail.queue_more", { count: rest })}
        </Text>
      ) : null}
    </View>
  );
}

function QueueRow({ task, issueText, wait }: { task: AgentTask; issueText: string; wait: string }) {
  const wsSlug = useWorkspaceStore((s) => s.currentWorkspaceSlug);
  const { colorScheme } = useColorScheme();
  const linked = !!task.issue_id;
  return (
    <Pressable
      disabled={!linked}
      onPress={() => {
        if (wsSlug && task.issue_id) router.push(`/${wsSlug}/issue/${task.issue_id}`);
      }}
      accessibilityRole={linked ? "link" : undefined}
      accessibilityLabel={`${issueText}, ${wait}`}
      testID="runtime-queue-item"
      className="flex-row items-center gap-3 px-4 py-2 min-h-12 active:bg-secondary"
    >
      <ActorAvatar type="agent" id={task.agent_id} size={24} showPresence />
      <View className="flex-1 gap-0.5">
        <Text className="text-sm text-foreground" numberOfLines={2}>
          {issueText}
        </Text>
        <Text
          className={cn(
            "text-xs",
            task.status === "waiting_local_directory" ? "text-warning" : "text-muted-foreground",
          )}
        >
          {wait}
        </Text>
      </View>
      {linked ? (
        <SymbolIcon name="chevron.right" size={14} color={THEME[colorScheme].mutedForeground} />
      ) : null}
    </Pressable>
  );
}

function ActivityBars({ bars }: { bars: number[] }) {
  const { t } = useT("workspace");
  const max = Math.max(0, ...bars);
  const summary = activitySummaryText(bars);
  if (max === 0) {
    return (
      <Text className="px-4 text-sm text-muted-foreground" testID="runtime-activity-empty">
        {summary}
      </Text>
    );
  }
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={summary}
      testID="runtime-activity"
      className="px-4 gap-1"
    >
      <Text className="text-xs text-muted-foreground">{t("runtime_detail.activity_hint")}</Text>
      <View className="h-16 flex-row items-end gap-px">
        {bars.map((count, hour) => (
          <View
            key={hour}
            className={cn("flex-1 rounded-sm", count > 0 ? "bg-primary" : "bg-secondary")}
            style={{ height: `${Math.max(4, Math.round((count / max) * 100))}%` }}
          />
        ))}
      </View>
      <View className="flex-row">
        {[0, 6, 12, 18].map((h) => (
          <Text key={h} className="flex-1 text-[11px] text-muted-foreground">
            {h}
          </Text>
        ))}
      </View>
      <Text className="text-xs text-muted-foreground">{summary}</Text>
    </View>
  );
}

function Section({
  title,
  testID,
  children,
}: {
  title: string;
  testID?: string;
  children: React.ReactNode;
}) {
  return (
    <View className="pt-5 gap-1" testID={testID}>
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
