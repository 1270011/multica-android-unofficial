/**
 * Transcript of one run inside the Runs sheet. Shown in
 * place of the list (Back returns to it) so no second sheet stacks on the
 * first. Messages come from `GET /api/tasks/{id}/messages`
 * (taskMessagesOptions, refetched on open for runs still going) and are
 * reduced by lib/run-transcript.ts. "Run again" only for failed /
 * cancelled runs, as on web.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, FlatList, Pressable, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import type { AgentTask } from "@multica/core/types";
import { Ionicons } from "@/components/ui/ionicons";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { taskMessagesOptions } from "@/data/queries/chat";
import { useRerunTask } from "@/data/mutations/issues";
import { useActorLookup } from "@/data/use-actor-name";
import { buildTranscript, canRetryRun, isRunLive, type TranscriptBlock } from "@/lib/run-transcript";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { useT } from "@/lib/i18n";

export function RunTranscript({ task, issueId, onBack }: { task: AgentTask; issueId: string; onBack: () => void }) {
  const { t } = useT("issues");
  const { colorScheme } = useColorScheme();
  const { getName } = useActorLookup();
  // Live runs poll while the transcript is open (the issue screen has no
  // task:message subscription for this cache).
  const { data, isLoading, error, refetch } = useQuery({
    ...taskMessagesOptions(task.id),
    staleTime: 0,
    refetchInterval: isRunLive(task) ? 3000 : false,
  });
  const blocks = useMemo(() => buildTranscript(data ?? []), [data]);
  // When the run finishes, polling stops; fetch once more so the last
  // seconds of the transcript are not missing (review #26).
  const live = isRunLive(task);
  const wasLive = useRef(live);
  useEffect(() => {
    if (wasLive.current && !live) void refetch();
    wasLive.current = live;
  }, [live, refetch]);
  const rerun = useRerunTask(issueId);

  return (
    <View className="flex-1">
      <View className="flex-row items-center gap-2 px-2 pt-3 pb-2">
        <Pressable
          onPress={onBack}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel={t("runs.back_to_list")}
          testID="run-transcript-back"
          className="h-12 w-12 items-center justify-center"
        >
          <Ionicons name="chevron-back" size={22} color={THEME[colorScheme].foreground} />
        </Pressable>
        <View className="flex-1">
          <Text className="text-base font-semibold text-foreground" numberOfLines={1}>
            {getName("agent", task.agent_id)}
          </Text>
          <Text className="text-xs text-muted-foreground">{t(`runs.status.${task.status}`)}</Text>
        </View>
      </View>
      {canRetryRun(task) ? (
        <View className="px-4 pb-2">
          <Button
            variant="outline"
            // Starting a run also replaces runs still waiting: ask first.
            onPress={() =>
              Alert.alert(t("runs.retry_confirm_title"), t("runs.retry_confirm_message"), [
                { text: t("common:actions.cancel"), style: "cancel" },
                { text: t("runs.retry_confirm_action"), onPress: () => rerun.mutate(task.id) },
              ])
            }
            disabled={rerun.isPending}
            testID="run-retry"
            accessibilityLabel={t("runs.retry")}
          >
            <Text>{rerun.isPending ? t("runs.retrying") : t("runs.retry")}</Text>
          </Button>
        </View>
      ) : null}
      {isLoading ? (
        <ActivityIndicator />
      ) : error ? (
        <View className="items-start gap-2 px-4">
          <Text className="text-sm text-destructive">{t("runs.transcript_failed")}</Text>
          <Button variant="outline" onPress={() => refetch()}>
            <Text>{t("runs.load_retry")}</Text>
          </Button>
        </View>
      ) : (
        // Virtualized: the messages endpoint has no limit.
        <FlatList
          data={blocks}
          keyExtractor={(_, i) => String(i)}
          renderItem={({ item }) => <Block block={item} />}
          contentContainerClassName="gap-2 px-4 pb-6"
          testID="run-transcript"
          ListEmptyComponent={
            <Text className="text-sm text-muted-foreground">{t("runs.transcript_empty")}</Text>
          }
        />
      )}
    </View>
  );
}

function Block({ block }: { block: TranscriptBlock }) {
  const { t } = useT("issues");
  const [open, setOpen] = useState(false);
  switch (block.kind) {
    case "text":
      return <Text className="text-sm text-foreground" selectable>{block.text}</Text>;
    case "thinking":
      return (
        <Pressable
          onPress={() => setOpen((v) => !v)}
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          className="min-h-9 justify-center"
        >
          <Text className="text-xs italic text-muted-foreground" numberOfLines={open ? undefined : 1}>
            {t("runs.thinking")}: {block.text}
          </Text>
        </Pressable>
      );
    case "tool":
      return (
        <Text className="text-xs text-muted-foreground" selectable>
          ▸ {block.tool}
          {block.input ? `  ${block.input}` : ""}
        </Text>
      );
    case "result":
      return (
        <Pressable
          onPress={() => setOpen((v) => !v)}
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          className="rounded-md bg-secondary/50 px-2 py-1.5"
        >
          <Text className="font-mono text-xs text-muted-foreground" numberOfLines={open ? undefined : 3} selectable>
            {block.output || t("runs.no_output")}
          </Text>
          {open && block.truncated ? (
            <Text className="pt-1 text-xs text-muted-foreground">{t("runs.output_truncated")}</Text>
          ) : null}
        </Pressable>
      );
    case "error":
      return <Text className="text-sm text-destructive" selectable>{block.text}</Text>;
  }
}
