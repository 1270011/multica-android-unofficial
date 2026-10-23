/**
 * Autopilot detail. Used by
 * the phone route `autopilots/[id]` and by the right pane of the tablet
 * split (W7 frame).
 *
 * - Head: title, status chip, system pause reason, "Jetzt ausführen" and
 *   pause/resume as buttons; "⋯" offers the rest (runs, delete).
 * - Assignee with the runtime state of the agent (or the squad leader)
 *   from the R1 presence matrix (lib/agent-hang-state.ts); offline adds the
 *   amber "geplante Läufe werden übersprungen" hint and a runtime link.
 * - Triggers read-only: cron as plain text with time zone; a webhook only
 *   as its kind, never its URL (the schema drops it already).
 * - Actions come from the list's menu hook, so toasts per run status,
 *   undo and "delete waits for the server" behave the same. Delete leaves
 *   the detail only after the server agreed (`onDeleted`).
 * Without write access there are no actions; "Läufe ansehen" opens
 * the read-only runs list.
 */
import { useMemo, useState } from "react";
import { Pressable, RefreshControl, ScrollView, View } from "react-native";
import { router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Skeleton } from "@/components/ui/skeleton";
import { Text } from "@/components/ui/text";
import type { MobileAutopilot } from "@/data/autopilot-schemas";
import { agentListOptions } from "@/data/queries/agents";
import { agentTaskSnapshotOptions } from "@/data/queries/agent-task-snapshot";
import { autopilotDetailOptions, autopilotKeys } from "@/data/queries/autopilots";
import { projectListOptions } from "@/data/queries/projects";
import { runtimeListOptions } from "@/data/queries/runtimes";
import { squadListOptions } from "@/data/queries/squads";
import { useWorkspaceStore } from "@/data/workspace-store";
import { deriveAgentHangState, describeAgentHangState, type AgentHangTone } from "@/lib/agent-hang-state";
import {
  formatOfflineFor,
  presenceAgentId,
  runtimeBlocksRuns,
  triggerLines,
} from "@/lib/autopilot-detail";
import { autopilotActions } from "@/lib/autopilot-list";
import { autopilotRunsHref } from "@/lib/autopilot-runs";
import { useT } from "@/lib/i18n";
import { i18n } from "@/lib/i18n/singleton";
import { guardedRefresh } from "@/lib/refresh-guard";
import { useRefreshOnFocus } from "@/lib/use-refresh-on-focus";
import { useVisibleNow } from "@/lib/use-visible-tick";
import { cn } from "@/lib/utils";
import { useAutopilotMenu } from "./use-autopilot-menu";

const STATUS_DOT: Record<MobileAutopilot["status"], string> = {
  active: "bg-success",
  paused: "bg-warning",
  archived: "bg-muted-foreground/40",
  unknown: "bg-muted-foreground/40",
};

const TONE_DOT: Record<AgentHangTone, string> = {
  ok: "bg-success",
  warning: "bg-warning",
  danger: "bg-destructive",
  muted: "bg-muted-foreground/40",
};

/** "21. Okt., 02:00" in the app language. */
function formatAbsolute(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const locale = i18n.resolvedLanguage ?? i18n.language;
  return d.toLocaleString(locale, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function AutopilotDetail({ id, onDeleted }: { id: string; onDeleted: () => void }) {
  const { t } = useT("workspace");
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const wsSlug = useWorkspaceStore((s) => s.currentWorkspaceSlug);
  const detail = useQuery(autopilotDetailOptions(wsId, id));
  const agents = useQuery(agentListOptions(wsId));
  const squads = useQuery(squadListOptions(wsId));
  const runtimes = useQuery(runtimeListOptions(wsId));
  const snapshot = useQuery(agentTaskSnapshotOptions(wsId));
  const projects = useQuery(projectListOptions(wsId));
  useRefreshOnFocus([autopilotKeys.detail(wsId, id)]);
  const menu = useAutopilotMenu({ onDeleted });
  const now = useVisibleNow();
  const [descOpen, setDescOpen] = useState(false);

  const a = detail.data?.autopilot;
  const triggers = useMemo(() => triggerLines(detail.data?.triggers ?? [], t), [detail.data?.triggers, t]);

  const hang = useMemo(() => {
    if (!a) return null;
    const agentId = presenceAgentId(a, squads.data);
    const agent = agentId ? agents.data?.find((x) => x.id === agentId) : undefined;
    if (!agent) return null;
    const runtime = runtimes.data?.find((r) => r.id === agent.runtime_id) ?? null;
    const tasks = (snapshot.data ?? []).filter((x) => x.agent_id === agent.id);
    const state = deriveAgentHangState({ agent, runtime, tasks, now });
    return { state, text: describeAgentHangState(state, t, (ms) => formatOfflineFor(ms, t)) };
  }, [a, squads.data, agents.data, runtimes.data, snapshot.data, now, t]);

  if (detail.isLoading) {
    return (
      <View
        className="flex-1 bg-background px-4 pt-4 gap-3"
        accessible
        accessibilityLabel={t("autopilot.loading")}
        accessibilityLiveRegion="polite"
        testID="autopilot-detail-loading"
      >
        <Skeleton className="h-5 w-2/3" />
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-4 w-3/4" />
      </View>
    );
  }

  if (!a) {
    return (
      <View className="flex-1 bg-background px-4 pt-6 gap-3" testID="autopilot-detail-missing">
        <Text className="text-sm text-muted-foreground">
          {detail.error ? t("autopilot.detail.load_failed") : t("autopilot.detail.not_found")}
        </Text>
        {detail.error ? (
          <Button variant="outline" onPress={() => detail.refetch()}>
            <Text>{t("common:actions.retry")}</Text>
          </Button>
        ) : null}
      </View>
    );
  }

  const statusText = a.status === "unknown" ? a.raw_status || "?" : t(`autopilot.status.${a.status}`);
  const actions = autopilotActions(a);
  const canRun = actions.includes("run");
  const toggle = actions.includes("pause") ? "pause" : actions.includes("resume") ? "resume" : null;
  const starting = menu.isStarting(a.id);

  const squad = a.assignee_type === "squad";
  const assigneeName = squad
    ? squads.data?.find((s) => s.id === a.assignee_id)?.name
    : agents.data?.find((x) => x.id === a.assignee_id)?.name;
  const assignee = assigneeName
    ? t(squad ? "autopilot.detail.assignee_squad" : "autopilot.detail.assignee_agent", { name: assigneeName })
    : t(squad ? "autopilot.assignee_squad_hidden" : "autopilot.assignee_agent_hidden");
  const blocked = hang ? runtimeBlocksRuns(hang.state.kind) : false;

  const mode =
    a.execution_mode === "create_issue"
      ? a.issue_title_template
        ? t("autopilot.detail.mode_create_issue_title", { title: a.issue_title_template })
        : t("autopilot.detail.mode_create_issue")
      : a.execution_mode === "run_only"
        ? t("autopilot.detail.mode_run_only")
        : t("autopilot.detail.mode_unknown");
  const project = a.project_id ? projects.data?.find((p) => p.id === a.project_id)?.title : null;

  const pauseReason = a.pause_reason
    ? t("autopilot.paused_by_system", {
        reason: i18n.exists(`workspace:autopilot.pause_reason.${a.pause_reason}`)
          ? t(`autopilot.pause_reason.${a.pause_reason}`)
          : a.pause_reason,
      })
    : null;

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerClassName="px-4 py-4 gap-4"
      testID="autopilot-detail"
      refreshControl={
        <RefreshControl
          refreshing={detail.isRefetching}
          onRefresh={() =>
            guardedRefresh(() =>
              Promise.all([detail.refetch(), agents.refetch(), runtimes.refetch(), snapshot.refetch()]),
            )
          }
        />
      }
    >
      {/* Head */}
      <View className="gap-2">
        <View className="flex-row items-start gap-2">
          <Text
            className="flex-1 text-lg font-semibold text-foreground"
            accessibilityRole="header"
            testID="autopilot-detail-title"
          >
            {a.title}
          </Text>
          {/* Runs and delete sit behind "⋯"; without write access it only
              offers "Läufe ansehen" (A4). */}
          {actions.length > 0 ? (
            <IconButton
              name="ellipsis-horizontal"
              onPress={() => menu.open(a)}
              accessibilityLabel={t("autopilot.actions_label", { title: a.title })}
              testID="autopilot-detail-menu"
            />
          ) : null}
        </View>
        <View className="flex-row items-center gap-1.5" testID={`autopilot-detail-status-${a.status}`}>
          <View className={cn("size-2 rounded-full", STATUS_DOT[a.status])} />
          <Text className="text-sm text-muted-foreground">{statusText}</Text>
        </View>
        {pauseReason ? <Text className="text-xs text-warning">{pauseReason}</Text> : null}
        {canRun || toggle ? (
          <View className="flex-row flex-wrap gap-2 pt-1">
            {canRun ? (
              <Button
                onPress={() => menu.run(a, "run")}
                disabled={starting}
                accessibilityState={{ busy: starting, disabled: starting }}
                testID="autopilot-detail-run"
              >
                <Text>{starting ? t("autopilot.running_toast") : t("autopilot.actions.run")}</Text>
              </Button>
            ) : null}
            {toggle ? (
              <Button variant="outline" onPress={() => menu.run(a, toggle)} testID={`autopilot-detail-${toggle}`}>
                <Text>{t(`autopilot.actions.${toggle}`)}</Text>
              </Button>
            ) : null}
          </View>
        ) : null}
      </View>

      {/* Facts */}
      <View className="gap-3">
        <Field label={t("autopilot.detail.assignee")} testID="autopilot-detail-assignee">
          <Text className="text-sm text-foreground">{assignee}</Text>
          {hang ? (
            <View className="flex-row items-center gap-1.5" testID={`autopilot-detail-presence-${hang.state.kind}`}>
              <View className={cn("size-2 rounded-full", TONE_DOT[hang.state.tone])} />
              <Text
                className={cn(
                  "text-sm",
                  hang.state.tone === "danger" ? "text-destructive font-medium" : "text-muted-foreground",
                )}
              >
                {hang.text.label}
              </Text>
            </View>
          ) : null}
          {hang?.text.hint ? <Text className="text-xs text-muted-foreground">{hang.text.hint}</Text> : null}
          {blocked ? (
            <View className="rounded-md bg-warning/10 px-3 py-2 gap-1" testID="autopilot-detail-runtime-warning">
              <Text className="text-xs text-warning">{t("autopilot.detail.runtime_offline_hint")}</Text>
              {wsSlug ? (
                <Pressable
                  onPress={() =>
                    router.push(
                      hang?.state.runtimeId ? `/${wsSlug}/runtimes/${hang.state.runtimeId}` : `/${wsSlug}/runtimes`,
                    )
                  }
                  accessibilityRole="link"
                  hitSlop={8}
                  testID="autopilot-detail-runtime-link"
                >
                  <Text className="text-xs text-primary font-medium">{t("autopilot.detail.view_runtime")}</Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}
        </Field>
        <Field label={t("autopilot.detail.mode")} testID="autopilot-detail-mode">
          <Text className="text-sm text-foreground">{mode}</Text>
        </Field>
        {project ? (
          <Field label={t("autopilot.detail.project")} testID="autopilot-detail-project">
            <Text className="text-sm text-foreground">{project}</Text>
          </Field>
        ) : null}
        <Field label={t("autopilot.detail.triggers")} testID="autopilot-detail-triggers">
          {triggers.length === 0 ? (
            <Text className="text-sm text-muted-foreground">{t("autopilot.detail.no_triggers")}</Text>
          ) : (
            triggers.map((tr) => (
              <View key={tr.id} className="gap-0.5" testID={`autopilot-trigger-${tr.kind}`}>
                <Text className="text-sm text-foreground">
                  {[tr.kindLabel, tr.label, tr.schedule].filter(Boolean).join(" · ")}
                  {tr.enabled ? "" : ` (${t("autopilot.detail.trigger_off")})`}
                </Text>
                {tr.timezone || tr.nextRunAt ? (
                  <Text className="text-xs text-muted-foreground">
                    {[
                      tr.timezone,
                      tr.nextRunAt ? t("autopilot.next_run", { time: formatAbsolute(tr.nextRunAt) }) : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </Text>
                ) : null}
              </View>
            ))
          )}
        </Field>
        {a.description?.trim() ? (
          <Field label={t("autopilot.detail.description")} testID="autopilot-detail-description">
            <Pressable
              onPress={() => setDescOpen((v) => !v)}
              accessibilityRole="button"
              accessibilityState={{ expanded: descOpen }}
              accessibilityHint={t(descOpen ? "autopilot.detail.collapse" : "autopilot.detail.expand")}
            >
              <Text className="text-sm text-foreground" numberOfLines={descOpen ? undefined : 4}>
                {a.description.trim()}
              </Text>
              <Text className="text-xs text-primary pt-1">
                {t(descOpen ? "autopilot.detail.collapse" : "autopilot.detail.expand")}
              </Text>
            </Pressable>
          </Field>
        ) : null}
        <Field label={t("autopilot.detail.last_run")} testID="autopilot-detail-last-run">
          <Text className="text-sm text-foreground">
            {a.last_run_at ? formatAbsolute(a.last_run_at) : t("autopilot.no_runs")}
          </Text>
          {wsSlug ? (
            <Pressable
              onPress={() => router.push(autopilotRunsHref(wsSlug, a.id))}
              accessibilityRole="link"
              hitSlop={8}
              className="self-start py-1"
              testID="autopilot-detail-runs"
            >
              <Text className="text-sm text-primary font-medium">{t("autopilot.actions.runs")}</Text>
            </Pressable>
          ) : null}
        </Field>
      </View>
    </ScrollView>
  );
}

function Field({ label, testID, children }: { label: string; testID: string; children: React.ReactNode }) {
  return (
    <View className="gap-1" testID={testID}>
      <Text className="text-xs font-medium text-muted-foreground uppercase">{label}</Text>
      {children}
    </View>
  );
}
