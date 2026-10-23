/**
 * Runtimes list. Replaces the
 * W7 placeholder:
 *
 * - grouped by machine (`lib/runtime-machines.ts`), problem → online →
 *   offline; "Lange offline (n)" collapsed at the end,
 * - problem banner when a runtime that is not online has tasks waiting; tap
 *   opens the first affected runtime,
 * - filter Alle/Meine (owner) and search over machine/runtime names,
 * - status from `deriveRuntimeHealth`, re-evaluated every 30 s only while the
 *   screen is visible (`useVisibleNow`, no extra requests — realtime keeps
 *   the runtime and snapshot caches fresh).
 *
 * A row opens the runtime detail (R3, `components/runtimes/runtime-detail`).
 * From 600 dp the detail sits on the right instead. A server without GET /api/runtimes
 * (404) keeps the W7 notice.
 */
import { useMemo, useState } from "react";
import { FlatList, Linking, Pressable, TextInput, useWindowDimensions, View } from "react-native";
import { router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { AiTeamPlaceholder } from "@/components/ai-team/placeholder";
import { RuntimeDetail } from "@/components/runtimes/runtime-detail";
import { useAiTeamGates } from "@/components/ai-team/use-ai-team-gates";
import { Button } from "@/components/ui/button";
import { MasterDetail } from "@/components/ui/master-detail";
import { SegmentedPills } from "@/components/ui/segmented-pills";
import { Skeleton } from "@/components/ui/skeleton";
import { SymbolIcon } from "@/components/ui/symbol-icon";
import { Text } from "@/components/ui/text";
import { useAuthStore } from "@/data/auth-store";
import { agentTaskSnapshotOptions } from "@/data/queries/agent-task-snapshot";
import { agentListOptions } from "@/data/queries/agents";
import { runtimeListOptions } from "@/data/queries/runtimes";
import { useWorkspaceStore } from "@/data/workspace-store";
import { masterDetailLayout } from "@/lib/ai-team";
import { useT } from "@/lib/i18n";
import { guardedRefresh } from "@/lib/refresh-guard";
import {
  buildRuntimeMachineGroups,
  filterRuntimeMachineGroups,
  partitionLongOffline,
  runtimeProblemSummary,
  type RuntimeMachineGroup,
  type RuntimeRowSummary,
} from "@/lib/runtime-machines";
import {
  machineA11yLabel,
  runtimeHealthText,
  runtimeHealthTone,
  runtimeProblemBannerText,
  runtimeRowA11yLabel,
  runtimeRowText,
} from "@/lib/runtime-list-texts";
import { THEME } from "@/lib/theme";
import { useColorScheme } from "@/lib/use-color-scheme";
import { useVisibleNow } from "@/lib/use-visible-tick";
import { cn } from "@/lib/utils";

type Scope = "all" | "mine";

type Item =
  | { kind: "machine"; key: string; group: RuntimeMachineGroup }
  | { kind: "runtime"; key: string; group: RuntimeMachineGroup; row: RuntimeRowSummary }
  | { kind: "long-offline"; key: string; count: number };

const TONE_DOT = { success: "bg-success", warning: "bg-warning", muted: "bg-muted-foreground/40" };
const TONE_TEXT = { success: "text-success", warning: "text-warning", muted: "text-muted-foreground" };

function flatten(
  visible: RuntimeMachineGroup[],
  longOffline: RuntimeMachineGroup[],
  expanded: boolean,
): Item[] {
  const items: Item[] = [];
  const push = (g: RuntimeMachineGroup) => {
    items.push({ kind: "machine", key: `m:${g.id}`, group: g });
    for (const row of g.runtimes) {
      items.push({ kind: "runtime", key: `r:${row.runtime.id}`, group: g, row });
    }
  };
  visible.forEach(push);
  if (longOffline.length > 0) {
    items.push({ kind: "long-offline", key: "long-offline", count: longOffline.length });
    if (expanded) longOffline.forEach(push);
  }
  return items;
}

export default function RuntimesPage() {
  const { t } = useT("workspace");
  const { t: tn } = useT("navigation");
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const wsSlug = useWorkspaceStore((s) => s.currentWorkspaceSlug);
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const gates = useAiTeamGates(wsId);
  const { width } = useWindowDimensions();
  const split = masterDetailLayout(width).split;

  const runtimes = useQuery(runtimeListOptions(wsId));
  const agents = useQuery(agentListOptions(wsId));
  const snapshot = useQuery(agentTaskSnapshotOptions(wsId));
  const now = useVisibleNow();

  const [scope, setScope] = useState<Scope>("all");
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);

  const groups = useMemo(
    () =>
      buildRuntimeMachineGroups({
        runtimes: runtimes.data ?? [],
        agents: agents.data ?? [],
        snapshot: snapshot.data ?? [],
        now,
      }),
    [runtimes.data, agents.data, snapshot.data, now],
  );
  const filtered = useMemo(
    () => filterRuntimeMachineGroups(groups, { scope, userId, query }),
    [groups, scope, userId, query],
  );
  const problem = useMemo(() => runtimeProblemSummary(filtered), [filtered]);
  const items = useMemo(() => {
    const { visible, longOffline } = partitionLongOffline(filtered);
    return flatten(visible, longOffline, expanded);
  }, [filtered, expanded]);

  const open = (runtimeId: string) => {
    if (split) setSelected(runtimeId);
    else if (wsSlug) router.push(`/${wsSlug}/runtimes/${runtimeId}`);
  };

  const selectedRow = selected
    ? groups.flatMap((g) => g.runtimes).find((r) => r.runtime.id === selected)
    : undefined;

  const list =
    gates.runtimes === "missing" ? (
      <AiTeamPlaceholder
        icon="server.rack"
        title={tn("ai_team.runtimes_title")}
        body={tn("ai_team.feature_missing")}
        testID="runtimes-missing"
      />
    ) : runtimes.isLoading ? (
      <ListLoading />
    ) : runtimes.error ? (
      <View className="px-4 gap-3 pt-4">
        <Text className="text-sm text-destructive">{t("runtime_list.load_failed")}</Text>
        <Button variant="outline" onPress={() => runtimes.refetch()}>
          <Text>{t("common:actions.retry")}</Text>
        </Button>
      </View>
    ) : (runtimes.data ?? []).length === 0 ? (
      <EmptyNoRuntime />
    ) : (
      <FlatList
        testID="runtimes-list"
        data={items}
        keyExtractor={(i) => i.key}
        contentContainerClassName="pb-6"
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <View>
            <SegmentedPills
              items={[
                { value: "all" as const, label: t("runtime_list.scope_all"), testID: "runtimes-scope-all" },
                { value: "mine" as const, label: t("runtime_list.scope_mine"), testID: "runtimes-scope-mine" },
              ]}
              value={scope}
              onChange={setScope}
            />
            <SearchField value={query} onChange={setQuery} />
            {problem ? (
              <ProblemBanner
                text={runtimeProblemBannerText(problem)}
                onPress={() => open(problem.firstRuntimeId)}
              />
            ) : null}
          </View>
        }
        ListEmptyComponent={
          <Empty
            testID="runtimes-empty-filter"
            text={
              query.trim()
                ? t("runtime_list.empty_search", { query: query.trim() })
                : t("runtime_list.empty_mine")
            }
          />
        }
        renderItem={({ item }) =>
          item.kind === "machine" ? (
            <MachineHeader group={item.group} />
          ) : item.kind === "runtime" ? (
            <RuntimeRow
              row={item.row}
              machine={item.group.title}
              now={now}
              selected={split && selected === item.row.runtime.id}
              onPress={() => open(item.row.runtime.id)}
            />
          ) : (
            <LongOfflineToggle
              count={item.count}
              expanded={expanded}
              onPress={() => setExpanded((v) => !v)}
            />
          )
        }
        refreshing={runtimes.isRefetching}
        onRefresh={() =>
          guardedRefresh(() => Promise.all([runtimes.refetch(), agents.refetch(), snapshot.refetch()]))
        }
      />
    );

  return (
    <View className="flex-1 bg-background">
      <MasterDetail
        list={list}
        detail={
          selectedRow ? (
            <RuntimeDetail key={selectedRow.runtime.id} runtimeId={selectedRow.runtime.id} />
          ) : (
            <AiTeamPlaceholder
              icon="chevron.right"
              title={tn("ai_team.detail_empty_title")}
              body={tn("ai_team.detail_empty_body")}
              testID="runtimes-detail-empty"
            />
          )
        }
      />
    </View>
  );
}

function SearchField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { t } = useT("workspace");
  const { colorScheme } = useColorScheme();
  return (
    <View className="mx-4 mb-2 flex-row items-center gap-2 rounded-md bg-secondary/50 px-3 min-h-10">
      <SymbolIcon name="magnifyingglass" size={16} color={THEME[colorScheme].mutedForeground} />
      <TextInput
        value={value}
        // Multiline so a long placeholder wraps at 200 % font instead of
        // being cut (same as the issue search); line breaks never reach the
        // query.
        onChangeText={(text) => onChange(text.replace(/\n/g, " "))}
        multiline
        submitBehavior="blurAndSubmit"
        placeholder={t("runtime_list.search_placeholder")}
        placeholderTextColor={THEME[colorScheme].mutedForeground}
        autoCorrect={false}
        autoCapitalize="none"
        returnKeyType="search"
        accessibilityLabel={t("runtime_list.search_placeholder")}
        testID="runtimes-search"
        className="flex-1 py-2 text-sm text-foreground"
      />
      {value ? (
        <Pressable
          onPress={() => onChange("")}
          accessibilityRole="button"
          accessibilityLabel={t("runtime_list.search_clear")}
          hitSlop={12}
          testID="runtimes-search-clear"
        >
          <SymbolIcon name="xmark.circle.fill" size={16} color={THEME[colorScheme].mutedForeground} />
        </Pressable>
      ) : null}
    </View>
  );
}

function ProblemBanner({ text, onPress }: { text: string; onPress: () => void }) {
  const { t } = useT("workspace");
  const { colorScheme } = useColorScheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={text}
      accessibilityHint={t("runtime_list.banner_hint")}
      testID="runtimes-problem-banner"
      className="mx-4 mb-2 flex-row items-center gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2.5 min-h-12 active:opacity-80"
    >
      <SymbolIcon name="exclamationmark.triangle.fill" size={16} color={THEME[colorScheme].warning} />
      <Text className="flex-1 text-sm text-foreground">{text}</Text>
      <SymbolIcon name="chevron.right" size={14} color={THEME[colorScheme].mutedForeground} />
    </Pressable>
  );
}

function MachineHeader({ group }: { group: RuntimeMachineGroup }) {
  const tone = runtimeHealthTone(group.health);
  return (
    <View
      accessible
      accessibilityRole="header"
      accessibilityLabel={machineA11yLabel(group)}
      testID="runtime-machine"
      className="flex-row items-center gap-2 px-4 pt-4 pb-1"
    >
      <Text className="flex-1 text-sm font-semibold text-foreground">{group.title}</Text>
      <View className={cn("size-2 rounded-full", TONE_DOT[tone])} />
      <Text className={cn("text-xs", TONE_TEXT[tone])}>{runtimeHealthText(group.health)}</Text>
    </View>
  );
}

function RuntimeRow({
  row,
  machine,
  now,
  selected,
  onPress,
}: {
  row: RuntimeRowSummary;
  machine: string;
  now: number;
  selected: boolean;
  onPress: () => void;
}) {
  const { t } = useT("workspace");
  const { colorScheme } = useColorScheme();
  const tone = runtimeHealthTone(row.health);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={runtimeRowA11yLabel(row, machine, now)}
      accessibilityState={{ selected }}
      testID={row.hasProblem ? "runtime-row-problem" : "runtime-row"}
      className={cn(
        "flex-row items-center gap-3 px-4 py-3 min-h-12 active:bg-secondary",
        selected && "bg-secondary",
      )}
    >
      <View className={cn("size-2.5 rounded-full", TONE_DOT[tone])} />
      <View className="flex-1 gap-0.5">
        <View className="flex-row flex-wrap items-center gap-x-2">
          <Text className="text-sm font-medium text-foreground">{row.label}</Text>
          {row.isCustomProfile ? (
            <View className="rounded border border-border px-1.5">
              <Text className="text-[11px] text-muted-foreground">{t("runtime_list.badge_custom")}</Text>
            </View>
          ) : null}
        </View>
        <Text className={cn("text-xs", row.hasProblem ? "text-warning" : "text-muted-foreground")}>
          {runtimeRowText(row, now)}
        </Text>
      </View>
      <SymbolIcon name="chevron.right" size={14} color={THEME[colorScheme].mutedForeground} />
    </Pressable>
  );
}

function LongOfflineToggle({
  count,
  expanded,
  onPress,
}: {
  count: number;
  expanded: boolean;
  onPress: () => void;
}) {
  const { t } = useT("workspace");
  const { colorScheme } = useColorScheme();
  const label = t("runtime_list.long_offline", { count });
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ expanded }}
      accessibilityHint={
        expanded ? t("runtime_list.long_offline_hint_hide") : t("runtime_list.long_offline_hint_show")
      }
      testID="runtimes-long-offline"
      className="mt-2 flex-row items-center gap-2 px-4 py-3 min-h-12 active:bg-secondary"
    >
      <SymbolIcon
        name={expanded ? "chevron.down" : "chevron.right"}
        size={14}
        color={THEME[colorScheme].mutedForeground}
      />
      <Text className="flex-1 text-sm text-muted-foreground">{label}</Text>
    </Pressable>
  );
}

function EmptyNoRuntime() {
  const { t } = useT("workspace");
  return (
    <View className="items-center px-8 py-12 gap-4" testID="runtimes-empty">
      <Text className="text-sm text-muted-foreground text-center">{t("runtime_list.empty")}</Text>
      <Button variant="outline" onPress={() => void Linking.openURL(t("runtime_list.docs_url"))}>
        <Text>{t("runtime_list.empty_guide")}</Text>
      </Button>
    </View>
  );
}

function Empty({ text, testID }: { text: string; testID: string }) {
  return (
    <View className="items-center px-8 py-12" testID={testID}>
      <Text className="text-sm text-muted-foreground text-center">{text}</Text>
    </View>
  );
}

function ListLoading() {
  return (
    <View className="px-4 pt-4 gap-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <View key={i} className="gap-2">
          <Skeleton className="h-3 w-1/3" />
          <Skeleton className="h-3.5 w-3/4" />
        </View>
      ))}
    </View>
  );
}
