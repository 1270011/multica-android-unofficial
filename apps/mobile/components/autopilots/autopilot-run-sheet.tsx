/**
 * Run sheet. Opened from a
 * row of the runs list as `autopilots/[id]/runs/[runId]` (formSheet).
 *
 * Status, source, triggered/finished, duration, reason (`reason_code`
 * translated, otherwise `failure_reason`), links to the issue and to the
 * task view, then `trigger_payload` and `result` as collapsible monospace
 * JSON blocks with "Kopieren". The block scrolls sideways at normal font
 * size and wraps from 130 % on, so it stays readable at 200 %.
 *
 * While the single-run request is in flight the row from the list shows
 * (the list omits the JSON). Read-only.
 */
import { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, useWindowDimensions, View } from "react-native";
import { router } from "expo-router";
import * as Clipboard from "expo-clipboard";
import { useQuery, useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Text } from "@/components/ui/text";
import type { MobileAutopilotRunList } from "@/data/autopilot-schemas";
import { autopilotKeys, autopilotRunOptions } from "@/data/queries/autopilots";
import { issueDetailOptions } from "@/data/queries/issues";
import { useWorkspaceStore } from "@/data/workspace-store";
import {
  flattenRunPages,
  formatRunDuration,
  formatRunJson,
  jsonBlockWraps,
  runDurationMs,
  runIssueHref,
  runReason,
  runSourceLabel,
  runStatusLabel,
  runTaskHref,
  runTone,
} from "@/lib/autopilot-runs";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { formatRunTime, RUN_TONE_DOT } from "./autopilot-runs";

export function AutopilotRunSheet({ id, runId }: { id: string; runId: string }) {
  const { t } = useT("workspace");
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const wsSlug = useWorkspaceStore((s) => s.currentWorkspaceSlug);
  const detail = useQuery({
    ...autopilotRunOptions(wsId, id, runId),
    placeholderData: () =>
      flattenRunPages(
        qc.getQueryData<InfiniteData<MobileAutopilotRunList>>(autopilotKeys.runs(wsId, id))?.pages,
      ).find((r) => r.id === runId),
  });
  const run = detail.data ?? null;
  const issue = useQuery(issueDetailOptions(wsId, run?.issue_id ?? ""));

  if (!run) {
    if (detail.isLoading) {
      return (
        <View
          className="flex-1 bg-background px-4 pt-6 gap-3"
          accessible
          accessibilityLabel={t("autopilot.loading")}
          accessibilityLiveRegion="polite"
          testID="autopilot-run-loading"
        >
          <Skeleton className="h-5 w-1/2" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-24 w-full" />
        </View>
      );
    }
    return (
      <View className="flex-1 bg-background px-4 pt-6 gap-3" testID="autopilot-run-error">
        <Text className="text-sm text-destructive">
          {detail.isError ? t("autopilot.runs.run_load_failed") : t("autopilot.runs.run_not_found")}
        </Text>
        <Button variant="outline" className="h-auto min-h-10 py-2" onPress={() => detail.refetch()} testID="autopilot-run-retry">
          <Text>{t("common:actions.retry")}</Text>
        </Button>
      </View>
    );
  }

  const duration = runDurationMs(run);
  const reason = runReason(run, t);
  const issueHref = wsSlug ? runIssueHref(wsSlug, run) : null;
  const taskHref = wsSlug ? runTaskHref(wsSlug, run) : null;
  const issueText = issue.data
    ? `${issue.data.identifier} ${issue.data.title}`
    : t("autopilot.runs.open_issue");
  const source = runSourceLabel(run, t);
  // Placeholder from the list: the JSON is not loaded yet.
  const jsonPending = detail.isPlaceholderData;

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerClassName="px-4 pt-6 pb-10 gap-4"
      testID="autopilot-run-sheet"
    >
      <View className="flex-row items-center gap-2" testID={`autopilot-run-sheet-status-${run.status}`}>
        <View className={cn("size-2.5 rounded-full", RUN_TONE_DOT[runTone(run.status)])} />
        <Text className="text-lg font-semibold text-foreground" accessibilityRole="header">
          {runStatusLabel(run, t)}
        </Text>
      </View>

      <View className="gap-3">
        {source ? <Field label={t("autopilot.runs.source_label")} value={source} testID="autopilot-run-source" /> : null}
        <Field
          label={t("autopilot.runs.triggered")}
          value={formatRunTime(run.triggered_at)}
          testID="autopilot-run-triggered"
        />
        {run.completed_at ? (
          <Field
            label={t("autopilot.runs.finished")}
            value={formatRunTime(run.completed_at)}
            testID="autopilot-run-finished"
          />
        ) : null}
        {duration !== null ? (
          <Field
            label={t("autopilot.runs.duration")}
            value={formatRunDuration(duration, t)}
            testID="autopilot-run-duration"
          />
        ) : null}
        {reason ? (
          <Field
            label={t("autopilot.runs.reason")}
            value={reason}
            tone={run.status === "failed" ? "danger" : "warning"}
            testID="autopilot-run-sheet-reason"
          />
        ) : null}
        {issueHref || taskHref ? (
          <View className="gap-1">
            <Text className="text-xs font-medium text-muted-foreground uppercase">
              {t("autopilot.runs.issue")}
            </Text>
            {issueHref ? (
              <Pressable
                onPress={() => router.push(issueHref)}
                accessibilityRole="link"
                hitSlop={8}
                className="self-start py-1"
                testID="autopilot-run-sheet-issue"
              >
                <Text className="text-sm text-primary font-medium">{issueText}</Text>
              </Pressable>
            ) : null}
            {taskHref ? (
              <Pressable
                onPress={() => router.push(taskHref)}
                accessibilityRole="link"
                hitSlop={8}
                className="self-start py-1"
                testID="autopilot-run-sheet-task"
              >
                <Text className="text-sm text-primary font-medium">{t("autopilot.runs.open_task")}</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </View>

      <JsonBlock
        title={t("autopilot.runs.payload")}
        value={run.trigger_payload}
        pending={jsonPending}
        initiallyOpen
        testID="autopilot-run-payload"
      />
      <JsonBlock
        title={t("autopilot.runs.result")}
        value={run.result}
        pending={jsonPending}
        initiallyOpen={false}
        testID="autopilot-run-result"
      />
    </ScrollView>
  );
}

function Field({
  label,
  value,
  tone,
  testID,
}: {
  label: string;
  value: string;
  tone?: "warning" | "danger";
  testID: string;
}) {
  return (
    <View className="gap-0.5" testID={testID}>
      <Text className="text-xs font-medium text-muted-foreground uppercase">{label}</Text>
      <Text
        className={cn(
          "text-sm",
          tone === "danger" ? "text-destructive" : tone === "warning" ? "text-warning" : "text-foreground",
        )}
      >
        {value}
      </Text>
    </View>
  );
}

/**
 * Collapsible, copyable monospace JSON. Sideways scrolling keeps the shape
 * at normal size; from 130 % font scale the lines wrap instead (a sideways
 * scroll of huge letters is unreadable).
 */
function JsonBlock({
  title,
  value,
  pending,
  initiallyOpen,
  testID,
}: {
  title: string;
  value: unknown;
  pending: boolean;
  initiallyOpen: boolean;
  testID: string;
}) {
  const { t } = useT("workspace");
  const { fontScale } = useWindowDimensions();
  const [open, setOpen] = useState(initiallyOpen);
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const text = formatRunJson(value);
  const wraps = jsonBlockWraps(fontScale);

  const copy = async () => {
    if (!text) return;
    try {
      await Clipboard.setStringAsync(text);
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard write failed: nothing useful to tell.
    }
  };

  const body = (
    <Text className="text-[13px] leading-5 font-mono text-foreground" selectable testID={`${testID}-text`}>
      {text}
    </Text>
  );

  return (
    <View className="gap-2" testID={testID}>
      <View className="flex-row flex-wrap items-center gap-2">
        <Pressable
          onPress={() => setOpen((v) => !v)}
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          hitSlop={8}
          className="flex-1 min-h-10 justify-center"
          testID={`${testID}-toggle`}
        >
          <Text className="text-sm font-medium text-foreground">
            {open ? "▾ " : "▸ "}
            {title}
          </Text>
        </Pressable>
        {text && open ? (
          // h-auto: the fixed button height clips the label at 200 %.
          <Button
            variant="outline"
            className="h-auto min-h-10 py-2"
            onPress={() => void copy()}
            testID={`${testID}-copy`}
          >
            <Text>{copied ? t("autopilot.runs.copied") : t("autopilot.runs.copy")}</Text>
          </Button>
        ) : null}
      </View>
      {open ? (
        pending ? (
          <Skeleton className="h-16 w-full" />
        ) : !text ? (
          <Text className="text-sm text-muted-foreground" testID={`${testID}-empty`}>
            {t("autopilot.runs.no_data")}
          </Text>
        ) : (
          <View className="bg-code-surface border border-border rounded-lg px-3 py-2">
            {wraps ? (
              body
            ) : (
              <ScrollView horizontal showsHorizontalScrollIndicator testID={`${testID}-scroll`}>
                {body}
              </ScrollView>
            )}
          </View>
        )
      ) : null}
    </View>
  );
}
