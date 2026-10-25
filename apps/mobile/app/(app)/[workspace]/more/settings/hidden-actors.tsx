/**
 * Settings › View › Hide people & agents (W4 P4).
 * Local only: one switch row per person/agent
 * (on = hidden), search, "Show all again". No API call; the list lives in
 * data/stores/view-prefs-store.ts per workspace and is cleared on logout.
 *
 * Rules (rows, counts, lock) are in lib/hidden-actors-screen.ts:
 *   - yourself: "(you)" without a switch
 *   - squads and archived agents are not listed
 *   - switches stay locked until the stored list is loaded
 * Where hiding takes effect (pickers, @-sheet, filters, agent list) comes
 * with P5/P6 via `isActorHidden`.
 */
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { Text } from "@/components/ui/text";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import { ActorAvatar } from "@/components/ui/actor-avatar";
import { READING_WIDTH_STYLE } from "@/components/ui/reading-width";
import { useAuthStore } from "@/data/auth-store";
import { useWorkspaceStore } from "@/data/workspace-store";
import { memberListOptions } from "@/data/queries/members";
import { agentListOptions } from "@/data/queries/agents";
import {
  useHiddenActors,
  useViewPrefsHydrated,
  useViewPrefsHydration,
  useViewPrefsStore,
} from "@/data/stores/view-prefs-store";
import { pruneHiddenActors } from "@/lib/view-prefs";
import {
  actorRowSwitchA11y,
  DECORATIVE_SWITCH_PROPS,
  buildHiddenActorsModel,
  type HiddenActorRow,
} from "@/lib/hidden-actors-screen";
import { useT } from "@/lib/i18n";

export default function HiddenActorsSettingsScreen() {
  const { t } = useT("settings");
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const selfUserId = useAuthStore((s) => s.user?.id ?? null);
  useViewPrefsHydration(wsId);
  const hydrated = useViewPrefsHydrated(wsId);
  const hidden = useHiddenActors(wsId);
  const setActorHidden = useViewPrefsStore((s) => s.setActorHidden);
  const setHiddenActors = useViewPrefsStore((s) => s.setHiddenActors);
  const showAllActors = useViewPrefsStore((s) => s.showAllActors);
  const [query, setQuery] = useState("");

  const membersQuery = useQuery(memberListOptions(wsId));
  const agentsQuery = useQuery(agentListOptions(wsId));
  const members = membersQuery.data;
  const agents = agentsQuery.data;

  // Drop ids of deleted members / archived agents once both lists are in
  // (docs: "IDs von gelöschten Akteuren werden beim Laden still verworfen").
  useEffect(() => {
    if (!wsId || !hydrated || !members || !agents) return;
    const pruned = pruneHiddenActors(hidden, {
      members: members.filter((m) => m.user_id !== selfUserId).map((m) => m.user_id),
      agents: agents.filter((a) => !a.archived_at).map((a) => a.id),
    });
    if (pruned !== hidden) setHiddenActors(wsId, pruned);
  }, [wsId, hydrated, members, agents, hidden, selfUserId, setHiddenActors]);

  const model = useMemo(
    () =>
      buildHiddenActorsModel({
        members: members ?? [],
        agents: agents ?? [],
        hidden,
        selfUserId,
        query,
        hydrated,
      }),
    [members, agents, hidden, selfUserId, query, hydrated],
  );

  const loading = membersQuery.isLoading || agentsQuery.isLoading;
  const failed = !members || !agents;
  const toggle = (row: HiddenActorRow, on: boolean) => {
    if (wsId && !row.disabled) setActorHidden(wsId, row.kind, row.id, on);
  };

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerClassName="px-4 py-4 gap-6"
      contentContainerStyle={READING_WIDTH_STYLE}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
    >
      <View className="gap-3">
        <Text className="text-sm text-muted-foreground px-1">
          {t("hidden_actors.intro")}
        </Text>
        <TextField
          value={query}
          onChangeText={setQuery}
          placeholder={t("hidden_actors.search_placeholder")}
          accessibilityLabel={t("hidden_actors.search_placeholder")}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          clearButtonMode="while-editing"
        />
      </View>

      {loading ? (
        <View className="py-8 items-center">
          <ActivityIndicator />
        </View>
      ) : failed ? (
        <Text className="text-sm text-destructive text-center px-1">
          {t("hidden_actors.load_failed")}
        </Text>
      ) : model.noMatches ? (
        <Text className="text-sm text-muted-foreground text-center px-1">
          {t("hidden_actors.no_results")}
        </Text>
      ) : (
        <>
          {model.people.length > 0 ? (
            <Section title={t("hidden_actors.section_people", { count: model.peopleHidden })}>
              {model.people.map((row, idx) => (
                <ActorRow
                  key={row.id}
                  row={row}
                  last={idx === model.people.length - 1}
                  onToggle={toggle}
                />
              ))}
            </Section>
          ) : null}
          {model.agents.length > 0 ? (
            <Section title={t("hidden_actors.section_agents", { count: model.agentsHidden })}>
              {model.agents.map((row, idx) => (
                <ActorRow
                  key={row.id}
                  row={row}
                  last={idx === model.agents.length - 1}
                  onToggle={toggle}
                />
              ))}
            </Section>
          ) : null}
        </>
      )}

      {/* Harmless and reversible, so no confirmation (docs W4). */}
      <Button
        variant="outline"
        disabled={!model.canShowAll}
        onPress={() => {
          if (wsId) showAllActors(wsId);
        }}
        accessibilityState={{ disabled: !model.canShowAll }}
      >
        <Text>{t("hidden_actors.show_all")}</Text>
      </Button>
    </ScrollView>
  );
}

function ActorRow({
  row,
  last,
  onToggle,
}: {
  row: HiddenActorRow;
  last: boolean;
  onToggle: (row: HiddenActorRow, on: boolean) => void;
}) {
  const { t } = useT("settings");
  const type = row.kind === "members" ? "member" : "agent";
  const a11y = actorRowSwitchA11y(row, t("hidden_actors.switch_a11y", { name: row.name }));
  const content = (
    <>
      <ActorAvatar type={type} id={row.id} name={row.name} avatarUrl={row.avatarUrl} size={28} />
      <Text className="flex-1 text-base text-foreground" numberOfLines={1}>
        {row.name}
        {row.isSelf ? (
          <Text className="text-muted-foreground">{` ${t("hidden_actors.you")}`}</Text>
        ) : null}
      </Text>
    </>
  );
  return (
    <View>
      {a11y ? (
        // The whole row toggles: >= 48 dp target, one TalkBack
        // stop. The Switch is only the visual state, not focusable/tappable
        // (DECORATIVE_SWITCH_PROPS).
        <Pressable
          {...a11y}
          disabled={row.disabled}
          onPress={() => onToggle(row, !row.hidden)}
          className="flex-row items-center px-4 py-3 gap-3 min-h-12 active:bg-secondary"
        >
          {content}
          <View pointerEvents="none" importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
            <Switch
              checked={row.hidden}
              disabled={row.disabled}
              onCheckedChange={() => {}}
              {...DECORATIVE_SWITCH_PROPS}
            />
          </View>
        </Pressable>
      ) : (
        <View className="flex-row items-center px-4 py-3 gap-3 min-h-12">{content}</View>
      )}
      {last ? null : <Separator />}
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View className="gap-2">
      {/* Header announces the hidden count ("Agents · 2 hidden"). */}
      <Text
        accessibilityRole="header"
        className="text-xs uppercase tracking-wider text-muted-foreground px-1"
      >
        {title}
      </Text>
      <View className="rounded-md border border-border bg-card overflow-hidden">
        {children}
      </View>
    </View>
  );
}
