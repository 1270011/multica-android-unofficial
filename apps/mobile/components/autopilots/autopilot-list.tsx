/**
 * Segment "Autopilots" of the Autopilots page.
 *
 * - Rows: title, status chip (dot + text), trigger kinds, assignee (agent
 *   or squad), next and last run, system pause reason.
 * - Status chips (Aktiv n · Pausiert n · Alle) and a title search, both
 *   client-side over one list fetch.
 * - Each row is one focus target with a composed label; "⋯" is its own
 *   target; long-press and TalkBack actions open the same menu. Without
 *   write access only "Läufe ansehen" is offered (use-autopilot-menu).
 * - Webhook URLs are never shown (§5 question 4; the schema drops them).
 * - No FAB in W1: creating and editing stay in the web app.
 */
import { useMemo, useState } from "react";
import { FlatList, Pressable, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import type { ComponentProps } from "react";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Ionicons } from "@/components/ui/ionicons";
import { SegmentedPills } from "@/components/ui/segmented-pills";
import { Skeleton } from "@/components/ui/skeleton";
import { Text } from "@/components/ui/text";
import { TextField } from "@/components/ui/text-field";
import { ListOffline } from "@/components/ui/list-offline";
import { listState } from "@/lib/list-state";
import type {
  AutopilotTriggerKindValue,
  MobileAutopilot,
} from "@/data/autopilot-schemas";
import { autopilotRunStatusOf } from "@/data/autopilot-schemas";
import { agentListOptions } from "@/data/queries/agents";
import { autopilotKeys, autopilotListOptions } from "@/data/queries/autopilots";
import { squadListOptions } from "@/data/queries/squads";
import { useWorkspaceStore } from "@/data/workspace-store";
import {
  autopilotFilterCounts,
  dayBucket,
  filterAutopilots,
  hasWriteActions,
  visibleNextRun,
  type AutopilotFilter,
} from "@/lib/autopilot-list";
import { useT } from "@/lib/i18n";
import { i18n } from "@/lib/i18n/singleton";
import { guardedRefresh } from "@/lib/refresh-guard";
import { THEME } from "@/lib/theme";
import { timeAgo } from "@/lib/time-ago";
import { useColorScheme } from "@/lib/use-color-scheme";
import { useRefreshOnFocus } from "@/lib/use-refresh-on-focus";
import { cn } from "@/lib/utils";
import { useAutopilotMenu } from "./use-autopilot-menu";

type IoniconName = ComponentProps<typeof Ionicons>["name"];

const TRIGGER_ICON: Record<AutopilotTriggerKindValue, IoniconName> = {
  schedule: "time-outline",
  webhook: "link-outline",
  api: "code-slash-outline",
  unknown: "help-circle-outline",
};

const STATUS_DOT: Record<MobileAutopilot["status"], string> = {
  active: "bg-success",
  paused: "bg-warning",
  archived: "bg-muted-foreground/40",
  unknown: "bg-muted-foreground/40",
};

export function AutopilotList({
  onOpen,
  selectedId,
}: {
  /** Row tap: push the detail (phone) or select it (tablet split). */
  onOpen: (a: MobileAutopilot) => void;
  /** Highlighted row in the tablet split. */
  selectedId?: string | null;
}) {
  const { t } = useT("workspace");
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const [filter, setFilter] = useState<AutopilotFilter>("all");
  const [query, setQuery] = useState("");

  const list = useQuery(autopilotListOptions(wsId));
  const agents = useQuery(agentListOptions(wsId));
  const squads = useQuery(squadListOptions(wsId));
  useRefreshOnFocus([autopilotKeys.all(wsId)]);
  const menu = useAutopilotMenu();

  const all = list.data?.autopilots;
  const counts = useMemo(() => autopilotFilterCounts(all ?? []), [all]);
  const rows = useMemo(() => filterAutopilots(all ?? [], filter, query), [all, filter, query]);
  const names = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of agents.data ?? []) m.set(a.id, a.name);
    for (const s of squads.data ?? []) m.set(s.id, s.name);
    return m;
  }, [agents.data, squads.data]);

  const state = listState(list);
  if (state === "loading") return <ListLoading label={t("autopilot.loading")} />;
  if (state === "offline") return <ListOffline onRetry={() => list.refetch()} testID="autopilots-offline" />;

  if (state === "error") {
    return (
      <View className="px-4 gap-3 pt-4" testID="autopilots-error">
        <Text className="text-sm text-destructive">{t("autopilot.load_failed")}</Text>
        <Button variant="outline" onPress={() => list.refetch()}>
          <Text>{t("common:actions.retry")}</Text>
        </Button>
      </View>
    );
  }

  const empty = (all ?? []).length === 0;
  const resetFilter = () => {
    setFilter("all");
    setQuery("");
  };

  return (
    <View className="flex-1" testID="autopilot-list">
      {list.error ? (
        <View className="mx-4 mt-2 rounded-md bg-destructive/10 px-3 py-2" accessibilityLiveRegion="polite">
          <Text className="text-xs text-destructive">{t("autopilot.refresh_failed")}</Text>
        </View>
      ) : null}
      {empty ? null : (
        <>
          <SegmentedPills
            items={[
              { value: "active" as const, label: t("autopilot.filter_active"), badge: counts.active, testID: "autopilot-filter-active" },
              { value: "paused" as const, label: t("autopilot.filter_paused"), badge: counts.paused, testID: "autopilot-filter-paused" },
              { value: "all" as const, label: t("autopilot.filter_all"), badge: counts.all, testID: "autopilot-filter-all" },
            ]}
            value={filter}
            onChange={setFilter}
          />
          <View className="flex-row items-center gap-1 px-4 pb-2">
            <TextField
              className="flex-1"
              value={query}
              onChangeText={setQuery}
              placeholder={t("autopilot.search_placeholder")}
              accessibilityLabel={t("autopilot.search_label")}
              autoCorrect={false}
              returnKeyType="search"
              testID="autopilot-search"
            />
            {query ? (
              <IconButton
                name="close-circle"
                onPress={() => setQuery("")}
                accessibilityLabel={t("autopilot.search_clear")}
              />
            ) : null}
          </View>
        </>
      )}
      <FlatList
        data={rows}
        keyExtractor={(a) => a.id}
        contentContainerClassName="pb-6 grow"
        ItemSeparatorComponent={() => <View className="h-px bg-border ml-4" />}
        ListEmptyComponent={
          empty ? (
            <Empty title={t("autopilot.empty_title")} body={t("autopilot.empty_body")} testID="autopilots-empty" />
          ) : (
            <View className="items-center px-8 py-12 gap-3" testID="autopilots-no-matches">
              <Text className="text-sm text-muted-foreground text-center">{t("autopilot.no_matches")}</Text>
              <Button variant="outline" onPress={resetFilter}>
                <Text>{t("autopilot.reset_filter")}</Text>
              </Button>
            </View>
          )
        }
        renderItem={({ item }) => (
          <AutopilotRow
            autopilot={item}
            assigneeName={names.get(item.assignee_id)}
            selected={item.id === selectedId}
            onOpen={() => onOpen(item)}
            onMenu={() => menu.open(item)}
            accessibilityActions={menu.accessibilityActionsFor(item)}
            onAccessibilityAction={(name) => {
              const action = menu.accessibilityActionsFor(item).find((x) => x.name === name);
              if (action) menu.run(item, action.name);
            }}
          />
        )}
        refreshing={list.isRefetching}
        onRefresh={() =>
          guardedRefresh(() => Promise.all([list.refetch(), agents.refetch(), squads.refetch()]))
        }
      />
    </View>
  );
}

/** "heute 02:00" / "morgen 02:00" / "21. Okt., 02:00". */
function formatWhen(iso: string, t: (k: string, o?: Record<string, unknown>) => string): string {
  const locale = i18n.resolvedLanguage ?? i18n.language;
  const d = new Date(iso);
  const time = d.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
  const bucket = dayBucket(iso);
  if (bucket === "today" || bucket === "tomorrow" || bucket === "yesterday") {
    return t(`autopilot.day_${bucket}`, { time });
  }
  return d.toLocaleString(locale, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

function AutopilotRow({
  autopilot: a,
  assigneeName,
  selected,
  onOpen,
  onMenu,
  accessibilityActions,
  onAccessibilityAction,
}: {
  autopilot: MobileAutopilot;
  assigneeName: string | undefined;
  selected: boolean;
  onOpen: () => void;
  onMenu: () => void;
  accessibilityActions: { name: string; label: string }[];
  onAccessibilityAction: (name: string) => void;
}) {
  const { t } = useT("workspace");
  const { colorScheme } = useColorScheme();
  const muted = THEME[colorScheme].mutedForeground;

  const statusText =
    a.status === "unknown" ? a.raw_status || "?" : t(`autopilot.status.${a.status}`);
  const triggers = a.trigger_kinds.map((kind, i) =>
    kind === "unknown" ? a.raw_trigger_kinds[i] || "?" : t(`autopilot.trigger.${kind}`),
  );
  // Private agents of others are not in the agent list: generic text.
  const squad = a.assignee_type === "squad";
  const assignee = assigneeName
    ? t(squad ? "autopilot.assignee_squad" : "autopilot.assignee_agent", { name: assigneeName })
    : t(squad ? "autopilot.assignee_squad_hidden" : "autopilot.assignee_agent_hidden");
  const meta = [...triggers, assignee].join(" · ");

  const nextAt = visibleNextRun(a);
  const next = nextAt ? t("autopilot.next_run", { time: formatWhen(nextAt, t) }) : null;
  const lastStatus = a.last_run_status
    ? (() => {
        const s = autopilotRunStatusOf(a.last_run_status);
        return s === "unknown" ? a.last_run_status : t(`autopilot.run_status.${s}`);
      })()
    : null;
  const last = a.last_run_at
    ? t("autopilot.last_run", { status: lastStatus ?? "", time: timeAgo(a.last_run_at) })
        .replace(/\s+/g, " ")
        .trim()
    : t("autopilot.no_runs");
  const runs = [next, last].filter(Boolean).join(" · ");
  const pauseReason = a.pause_reason
    ? t("autopilot.paused_by_system", {
        reason: i18n.exists(`workspace:autopilot.pause_reason.${a.pause_reason}`)
          ? t(`autopilot.pause_reason.${a.pause_reason}`)
          : a.pause_reason,
      })
    : null;

  // TalkBack: absolute next-run time in the label.
  const label = [
    t("autopilot.row_label", { title: a.title, status: statusText }),
    meta,
    next,
    last,
    pauseReason,
  ]
    .filter(Boolean)
    .join(", ");
  // Without write access the menu only offers the read-only runs jump.
  const writable = hasWriteActions(a);

  return (
    <Pressable
      // Tap opens the detail; long-press keeps the menu.
      onPress={onOpen}
      onLongPress={onMenu}
      accessible
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      accessibilityActions={accessibilityActions}
      onAccessibilityAction={(e) => onAccessibilityAction(e.nativeEvent.actionName)}
      testID="autopilot-row"
      className={cn(
        "flex-row items-start gap-2 pl-4 pr-1 py-3 min-h-12 active:bg-secondary",
        selected && "bg-secondary",
      )}
    >
      <View className="flex-1 gap-1">
        <View className="flex-row flex-wrap items-center gap-x-2 gap-y-1">
          <Text className="text-sm font-medium text-foreground shrink">{a.title}</Text>
          <View className="flex-row items-center gap-1" testID={`autopilot-status-${a.status}`}>
            <View className={cn("size-2 rounded-full", STATUS_DOT[a.status])} />
            <Text className="text-xs text-muted-foreground">{statusText}</Text>
          </View>
        </View>
        <View className="flex-row flex-wrap items-center gap-1">
          {a.trigger_kinds.map((kind, i) => (
            <Ionicons key={`${kind}-${i}`} name={TRIGGER_ICON[kind]} size={12} color={muted} />
          ))}
          <Text className="text-xs text-muted-foreground shrink">{meta}</Text>
        </View>
        <Text className="text-xs text-muted-foreground">{runs}</Text>
        {pauseReason ? <Text className="text-xs text-warning">{pauseReason}</Text> : null}
      </View>
      <IconButton
        name="ellipsis-horizontal"
        onPress={onMenu}
        accessibilityLabel={t("autopilot.actions_label", { title: a.title })}
        testID={writable ? "autopilot-row-menu" : "autopilot-row-menu-readonly"}
      />
    </Pressable>
  );
}

function Empty({ title, body, testID }: { title: string; body: string; testID: string }) {
  const { colorScheme } = useColorScheme();
  return (
    <View
      className="items-center px-8 py-12 gap-3"
      accessible
      accessibilityLabel={`${title}. ${body}`}
      testID={testID}
    >
      <Ionicons name="flash-outline" size={32} color={THEME[colorScheme].mutedForeground} />
      <Text className="text-base font-medium text-foreground text-center">{title}</Text>
      <Text className="text-sm text-muted-foreground text-center">{body}</Text>
    </View>
  );
}

function ListLoading({ label }: { label: string }) {
  return (
    <View
      className="px-4 pt-4 gap-5"
      accessible
      accessibilityLabel={label}
      accessibilityLiveRegion="polite"
      testID="autopilots-loading"
    >
      {Array.from({ length: 4 }).map((_, i) => (
        <View key={i} className="gap-2">
          <Skeleton className="h-3.5 w-1/2" />
          <Skeleton className="h-3 w-3/4" />
          <Skeleton className="h-3 w-2/3" />
        </View>
      ))}
    </View>
  );
}
