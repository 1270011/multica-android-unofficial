/**
 * Runs of one autopilot.
 * Opened by "Läufe ansehen" in the row menu and in the detail.
 *
 * - Paging with `limit=20` over the A1 infinite query; "Weitere laden"
 *   fetches the next page while the last one was full.
 * - Row: status dot + text (`skipped` with its reason, unknown = raw
 *   text), start time, duration, source and the created issue (tappable).
 *   Tap on the row opens the run sheet (`runs/[runId]`).
 * - Loading, empty and error states; an error after rows were loaded keeps
 *   the rows and shows a banner.
 * Read-only: nothing here triggers, pauses or deletes.
 */
import { useMemo } from "react";
import { FlatList, Pressable, View } from "react-native";
import { router } from "expo-router";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Ionicons } from "@/components/ui/ionicons";
import { Skeleton } from "@/components/ui/skeleton";
import { Text } from "@/components/ui/text";
import type { MobileAutopilotRun } from "@/data/autopilot-schemas";
import { autopilotKeys, autopilotRunsOptions } from "@/data/queries/autopilots";
import { useWorkspaceStore } from "@/data/workspace-store";
import {
  autopilotRunHref,
  flattenRunPages,
  formatRunDuration,
  runDurationMs,
  runIssueHref,
  runReason,
  runsListState,
  runSourceLabel,
  runStatusLabel,
  runTone,
  type RunTone,
} from "@/lib/autopilot-runs";
import { useT } from "@/lib/i18n";
import { i18n } from "@/lib/i18n/singleton";
import { guardedRefresh } from "@/lib/refresh-guard";
import { THEME } from "@/lib/theme";
import { useColorScheme } from "@/lib/use-color-scheme";
import { useRefreshOnFocus } from "@/lib/use-refresh-on-focus";
import { cn } from "@/lib/utils";

export const RUN_TONE_DOT: Record<RunTone, string> = {
  success: "bg-success",
  running: "bg-primary",
  warning: "bg-warning",
  danger: "bg-destructive",
  muted: "bg-muted-foreground/40",
};

/** "21. Okt., 02:00" in the app language. */
export function formatRunTime(iso: string): string {
  const d = new Date(iso);
  if (!iso || Number.isNaN(d.getTime())) return iso || "?";
  const locale = i18n.resolvedLanguage ?? i18n.language;
  return d.toLocaleString(locale, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function AutopilotRuns({ id }: { id: string }) {
  const { t } = useT("workspace");
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const wsSlug = useWorkspaceStore((s) => s.currentWorkspaceSlug);
  const runs = useInfiniteQuery(autopilotRunsOptions(wsId, id));
  useRefreshOnFocus([autopilotKeys.runs(wsId, id)]);

  const rows = useMemo(() => flattenRunPages(runs.data?.pages), [runs.data?.pages]);
  const state = runsListState({ isLoading: runs.isLoading, isError: runs.isError, rows: rows.length });

  if (state === "loading") {
    return (
      <View
        className="flex-1 bg-background px-4 pt-4 gap-4"
        accessible
        accessibilityLabel={t("autopilot.loading")}
        accessibilityLiveRegion="polite"
        testID="autopilot-runs-loading"
      >
        {[0, 1, 2, 3].map((i) => (
          <View key={i} className="gap-2">
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-3 w-3/4" />
          </View>
        ))}
      </View>
    );
  }

  if (state === "error") {
    return (
      <View className="flex-1 bg-background px-4 pt-4 gap-3" testID="autopilot-runs-error">
        <Text className="text-sm text-destructive">{t("autopilot.runs.load_failed")}</Text>
        <Button variant="outline" className="h-auto min-h-10 py-2" onPress={() => runs.refetch()} testID="autopilot-runs-retry">
          <Text>{t("common:actions.retry")}</Text>
        </Button>
      </View>
    );
  }

  const open = (run: MobileAutopilotRun) => {
    if (wsSlug) router.push(autopilotRunHref(wsSlug, id, run.id));
  };

  return (
    <FlatList
      className="flex-1 bg-background"
      testID="autopilot-runs"
      data={rows}
      keyExtractor={(r) => r.id}
      renderItem={({ item }) => <RunRow run={item} wsSlug={wsSlug} onOpen={() => open(item)} />}
      ItemSeparatorComponent={() => <View className="h-px bg-border ml-4" />}
      onRefresh={() => guardedRefresh(() => runs.refetch())}
      refreshing={runs.isRefetching && !runs.isFetchingNextPage}
      ListHeaderComponent={
        runs.isError ? (
          <View className="mx-4 mt-2 rounded-md bg-destructive/10 px-3 py-2" accessibilityLiveRegion="polite">
            <Text className="text-xs text-destructive">{t("autopilot.runs.refresh_failed")}</Text>
          </View>
        ) : null
      }
      ListEmptyComponent={<RunsEmpty />}
      ListFooterComponent={
        runs.hasNextPage ? (
          <View className="px-4 py-4">
            <Button
              variant="outline"
              className="h-auto min-h-10 py-2"
              onPress={() => void runs.fetchNextPage()}
              disabled={runs.isFetchingNextPage}
              accessibilityState={{ busy: runs.isFetchingNextPage, disabled: runs.isFetchingNextPage }}
              testID="autopilot-runs-more"
            >
              <Text>{runs.isFetchingNextPage ? t("autopilot.loading") : t("autopilot.runs.load_more")}</Text>
            </Button>
          </View>
        ) : rows.length > 0 ? (
          <Text className="text-xs text-muted-foreground text-center py-4" testID="autopilot-runs-end">
            {t("autopilot.runs.end")}
          </Text>
        ) : null
      }
    />
  );
}

function RunRow({ run, wsSlug, onOpen }: { run: MobileAutopilotRun; wsSlug: string | null; onOpen: () => void }) {
  const { t } = useT("workspace");
  const status = runStatusLabel(run, t);
  const duration = runDurationMs(run);
  const reason = run.status === "skipped" || run.status === "failed" ? runReason(run, t) : null;
  const issueHref = wsSlug ? runIssueHref(wsSlug, run) : null;
  const meta = [
    formatRunTime(run.triggered_at),
    duration !== null ? formatRunDuration(duration, t) : null,
    runSourceLabel(run, t) || null,
  ]
    .filter(Boolean)
    .join(" · ");
  const label = [t("autopilot.runs.row_label", { status }), meta, reason, issueHref ? t("autopilot.runs.has_issue") : null]
    .filter(Boolean)
    .join(", ");

  return (
    <Pressable
      onPress={onOpen}
      accessible
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={t("autopilot.runs.open_hint")}
      testID="autopilot-run-row"
      className="px-4 py-3 gap-1 min-h-12 active:bg-secondary"
    >
      <View className="flex-row flex-wrap items-center gap-x-2 gap-y-1">
        <View className="flex-row items-center gap-1.5" testID={`autopilot-run-status-${run.status}`}>
          <View className={cn("size-2 rounded-full", RUN_TONE_DOT[runTone(run.status)])} />
          <Text className="text-sm font-medium text-foreground">{status}</Text>
        </View>
      </View>
      <Text className="text-xs text-muted-foreground">{meta}</Text>
      {reason ? (
        <Text
          className={cn("text-xs", run.status === "failed" ? "text-destructive" : "text-warning")}
          testID="autopilot-run-reason"
        >
          {reason}
        </Text>
      ) : null}
      {issueHref ? (
        <Pressable
          onPress={() => router.push(issueHref)}
          accessibilityRole="link"
          accessibilityLabel={t("autopilot.runs.open_issue")}
          hitSlop={8}
          className="self-start py-1"
          testID="autopilot-run-issue"
        >
          <Text className="text-xs text-primary font-medium">{t("autopilot.runs.open_issue")}</Text>
        </Pressable>
      ) : null}
    </Pressable>
  );
}

function RunsEmpty() {
  const { t } = useT("workspace");
  const { colorScheme } = useColorScheme();
  return (
    <View
      className="items-center px-8 py-12 gap-3"
      accessible
      accessibilityLabel={`${t("autopilot.runs.empty_title")}. ${t("autopilot.runs.empty_body")}`}
      testID="autopilot-runs-empty"
    >
      <Ionicons name="time-outline" size={32} color={THEME[colorScheme].mutedForeground} />
      <Text className="text-base font-medium text-foreground text-center">{t("autopilot.runs.empty_title")}</Text>
      <Text className="text-sm text-muted-foreground text-center">{t("autopilot.runs.empty_body")}</Text>
    </View>
  );
}
