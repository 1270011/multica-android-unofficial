/**
 * Runs of one issue wakeup. Opened by "Läufe
 * ansehen" in the wakeup row's "⋯" menu (also without rights); the header's
 * Back returns to the issue.
 *
 * - Head: the rule in plain words, which agent it wakes, runs started.
 * - Rows, newest first: status dot + text (unknown = raw text), start time,
 *   duration, triggers, "Hat kommentiert" or the check-in note
 *   (lib/wakeup-runs.ts). The server returns the latest 10 without paging.
 * - Tap on a row opens the issue's runs sheet (`issue/[id]/runs?task=`)
 *   with that run's transcript, while the issue still lists the task.
 * - Loading, empty and error states; an error after rows were loaded keeps
 *   the rows and shows a banner.
 * Read-only: nothing here triggers, switches or deletes.
 */
import { useMemo } from "react";
import { FlatList, Pressable, View } from "react-native";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { RUN_TONE_DOT } from "@/components/autopilots/autopilot-runs";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Text } from "@/components/ui/text";
import { issueKeys } from "@/data/queries/issue-keys";
import { issueTasksOptions } from "@/data/queries/issues";
import { issueWakeupRunsOptions, issueWakeupsOptions, wakeupKeys } from "@/data/queries/wakeups";
import type { WakeupRun } from "@/data/wakeup-schemas";
import { useWorkspaceStore } from "@/data/workspace-store";
import { runsListState } from "@/lib/autopilot-runs";
import { useT } from "@/lib/i18n";
import { guardedRefresh } from "@/lib/refresh-guard";
import { useRefreshOnFocus } from "@/lib/use-refresh-on-focus";
import { cn } from "@/lib/utils";
import { WAKEUP_RUNS_LIMIT, wakeupRunRow } from "@/lib/wakeup-runs";
import { wakeupTriggerText } from "@/lib/wakeup-text";

export default function WakeupRunsScreen() {
  const { id: issueId, wakeupId } = useLocalSearchParams<{ id: string; wakeupId: string }>();
  const { t } = useT("issues");
  const { t: tNav } = useT("navigation");
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const wsSlug = useWorkspaceStore((s) => s.currentWorkspaceSlug);
  const rules = useQuery(issueWakeupsOptions(wsId, issueId));
  const runs = useQuery(issueWakeupRunsOptions(wsId, issueId, wakeupId));
  const tasks = useQuery(issueTasksOptions(wsId, issueId));
  useRefreshOnFocus([wakeupKeys.runs(wsId, issueId, wakeupId), issueKeys.tasks(wsId, issueId)]);

  const rule = rules.data?.find((w) => w.id === wakeupId);
  const agent = rule?.agent_name || t("wakeups.agent_subject");
  const rows = runs.data ?? [];
  const state = runsListState({ isLoading: runs.isLoading, isError: runs.isError, rows: rows.length });
  const taskIds = useMemo(() => new Set((tasks.data ?? []).map((task) => task.id)), [tasks.data]);
  // Until the issue's tasks are loaded every row stays tappable; the runs
  // sheet falls back to its list for an id it does not know.
  const canOpen = (run: WakeupRun) => !tasks.isSuccess || taskIds.has(run.id);
  const open = (run: WakeupRun) => {
    if (!wsSlug) return;
    router.push({
      pathname: "/[workspace]/issue/[id]/runs",
      params: { workspace: wsSlug, id: issueId, task: run.id },
    });
  };

  const title = rule?.agent_name
    ? tNav("routes.wakeup_runs_of", { agent: rule.agent_name })
    : tNav("routes.wakeup_runs");

  const head = (
    <View className="px-4 pt-4 pb-3 gap-1 border-b border-border" testID="wakeup-runs-head">
      {rule ? (
        <>
          <Text className="text-sm font-medium text-foreground">
            {wakeupTriggerText(rule)} · {t("wakeups.run_list.heading", { agent })}
          </Text>
          <Text className="text-xs text-muted-foreground">
            {rule.max_fires
              ? t("wakeups.run_list.fires_max", { count: rule.fire_count ?? 0, max: rule.max_fires })
              : t("wakeups.run_list.fires", { count: rule.fire_count ?? 0 })}
          </Text>
        </>
      ) : rules.isSuccess ? (
        <Text className="text-sm text-muted-foreground" testID="wakeup-runs-gone">
          {t("wakeups.run_list.gone")}
        </Text>
      ) : null}
      {rows.length >= WAKEUP_RUNS_LIMIT ? (
        <Text className="text-xs text-muted-foreground" testID="wakeup-runs-latest">
          {t("wakeups.run_list.latest", { count: WAKEUP_RUNS_LIMIT })}
        </Text>
      ) : null}
      {runs.isError && rows.length > 0 ? (
        <View className="mt-1 rounded-md bg-destructive/10 px-3 py-2" accessibilityLiveRegion="polite">
          <Text className="text-xs text-destructive">{t("wakeups.run_list.refresh_failed")}</Text>
        </View>
      ) : null}
    </View>
  );

  return (
    <>
      <Stack.Screen options={{ title }} />
      {state === "loading" ? (
        <View
          className="flex-1 bg-background px-4 pt-4 gap-4"
          accessible
          accessibilityLabel={t("wakeups.run_list.loading")}
          accessibilityLiveRegion="polite"
          testID="wakeup-runs-loading"
        >
          {[0, 1, 2].map((i) => (
            <View key={i} className="gap-2">
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-3 w-3/4" />
            </View>
          ))}
        </View>
      ) : state === "error" ? (
        <View className="flex-1 bg-background">
          {head}
          <View className="px-4 pt-4 gap-3" testID="wakeup-runs-error">
            <Text className="text-sm text-destructive">{t("wakeups.run_list.error")}</Text>
            <Button
              variant="outline"
              className="h-auto min-h-10 py-2"
              onPress={() => runs.refetch()}
              testID="wakeup-runs-retry"
            >
              <Text>{t("common:actions.retry")}</Text>
            </Button>
          </View>
        </View>
      ) : (
        <FlatList
          className="flex-1 bg-background"
          testID="wakeup-runs"
          data={rows}
          keyExtractor={(r) => r.id}
          renderItem={({ item }) => (
            <RunRow run={item} agent={rule?.agent_name} onOpen={canOpen(item) ? () => open(item) : undefined} />
          )}
          ItemSeparatorComponent={() => <View className="h-px bg-border ml-4" />}
          onRefresh={() => guardedRefresh(() => Promise.all([runs.refetch(), tasks.refetch()]))}
          refreshing={runs.isRefetching}
          ListHeaderComponent={head}
          ListEmptyComponent={
            <Text className="px-4 py-6 text-sm text-muted-foreground" testID="wakeup-runs-empty">
              {t("wakeups.run_list.empty")}
            </Text>
          }
        />
      )}
    </>
  );
}

function RunRow({ run, agent, onOpen }: { run: WakeupRun; agent?: string | null; onOpen?: () => void }) {
  const { t } = useT("issues");
  const row = wakeupRunRow(run, agent);
  return (
    <Pressable
      onPress={onOpen}
      disabled={!onOpen}
      accessible
      accessibilityRole={onOpen ? "button" : "text"}
      accessibilityLabel={onOpen ? row.a11y : `${row.a11y}, ${t("wakeups.run_list.no_task")}`}
      accessibilityHint={onOpen ? t("wakeups.run_list.open_hint") : undefined}
      testID={`wakeup-run-row-${run.id}`}
      className="px-4 py-3 gap-1 min-h-12 active:bg-secondary"
    >
      <View className="flex-row items-center gap-1.5" testID={`wakeup-run-status-${run.status || "unknown"}`}>
        <View className={cn("size-2 rounded-full", RUN_TONE_DOT[row.tone])} />
        <Text className="flex-1 text-sm font-medium text-foreground">{row.status}</Text>
      </View>
      {row.meta ? <Text className="text-xs text-muted-foreground">{row.meta}</Text> : null}
      {row.triggers ? <Text className="text-xs text-muted-foreground">{row.triggers}</Text> : null}
      {row.outcome ? (
        <Text className="text-xs text-foreground" testID="wakeup-run-outcome">
          {row.outcome}
        </Text>
      ) : null}
    </Pressable>
  );
}
