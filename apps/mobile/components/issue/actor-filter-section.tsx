/**
 * Assignee and creator sections of the issue filter sheet. The values go to the server
 * (`toListParams`); the store setters keep "Nobody" exclusive.
 *
 * - Assignee: "My agents and squads", "Me", "Nobody", assignee kind
 *   (members/agents/squads) and a people list.
 * - Creator: "Me" and a list of members and agents.
 *
 * The sheet shows ACTOR_LIST_PREVIEW people; "Show all (n)" opens
 * `ActorFilterPicker`, a sub-screen with search, so the sheet stays usable
 * at 200 % font size.
 *
 * People and agents hidden in Settings › View are left out of
 * both lists unless picked; the sub-screen's search lists them dimmed under
 * "Hidden".
 */
import { useEffect, useState } from "react";
import { BackHandler, FlatList, Pressable, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { Text } from "@/components/ui/text";
import { TextField } from "@/components/ui/text-field";
import { Ionicons } from "@/components/ui/ionicons";
import { ActorAvatar } from "@/components/ui/actor-avatar";
import { FilterRow, SectionLabel } from "@/components/issue/filter-rows";
import { memberListOptions } from "@/data/queries/members";
import { agentListOptions } from "@/data/queries/agents";
import { squadListOptions } from "@/data/queries/squads";
import {
  type IssueFilterList,
  useIssueListFilterStore,
} from "@/data/stores/issue-list-filter-store";
import {
  useHiddenActors,
  useViewPrefsHydration,
} from "@/data/stores/view-prefs-store";
import {
  type ActorDirectory,
  type ActorOption,
  actorOptionA11yLabel,
  actorOptionHint,
  actorOptions,
  type FilterSection,
  hiddenActorOptions,
  lockedByNobody,
  previewOptions,
} from "@/lib/actor-filter-options";
import {
  type ActorKey,
  actorKey,
  ASSIGNEE_TYPES,
  CREATOR_TYPES,
  type IssueListFilters,
} from "@/lib/issue-list-filters";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const AVATAR_SIZE = 24;

/** Members, agents and squads plus a combined load state. */
function useActorDirectory(wsId: string, withSquads: boolean) {
  const members = useQuery(memberListOptions(wsId));
  const agents = useQuery(agentListOptions(wsId));
  const squads = useQuery({ ...squadListOptions(wsId), enabled: withSquads });
  const dir: ActorDirectory = {
    members: members.data ?? [],
    agents: agents.data ?? [],
    squads: withSquads ? (squads.data ?? []) : [],
  };
  const failed =
    !!members.error || !!agents.error || (withSquads && !!squads.error);
  const retry = () => {
    if (members.error) void members.refetch();
    if (agents.error) void agents.refetch();
    if (withSquads && squads.error) void squads.refetch();
  };
  return { dir, failed, retry };
}

/** The workspace's hidden people/agents, loaded from storage on first use. */
function useHiddenForFilters(wsId: string) {
  useViewPrefsHydration(wsId);
  return useHiddenActors(wsId);
}

function sectionValues(section: FilterSection, filters: IssueListFilters) {
  return section === "assignee" ? filters.assignees : filters.creators;
}

function sectionTypes(section: FilterSection) {
  return section === "assignee" ? ASSIGNEE_TYPES : CREATOR_TYPES;
}

export function ActorFilterSection({
  section,
  list,
  wsId,
  userId,
  filters,
  visible,
  onShowAll,
}: {
  section: FilterSection;
  list: IssueFilterList;
  wsId: string;
  userId: string | null;
  filters: IssueListFilters;
  /** showsAssigneeFilter / showsCreatorFilter; false → the fixed-tab hint. */
  visible: boolean;
  onShowAll: () => void;
}) {
  const { t } = useT("issues");
  const { colorScheme } = useColorScheme();
  const muted = THEME[colorScheme].mutedForeground;
  const isAssignee = section === "assignee";
  const { dir, failed, retry } = useActorDirectory(wsId, isAssignee && visible);
  const hiddenActors = useHiddenForFilters(wsId);
  const selected = sectionValues(section, filters);
  const options = actorOptions(dir, {
    userId,
    types: sectionTypes(section),
    selected,
    hidden: hiddenActors,
  });

  if (!visible) {
    return (
      <>
        <SectionLabel>{t(isAssignee ? "filters.assignment" : "filters.creator")}</SectionLabel>
        <Text className="px-4 py-2 text-sm text-muted-foreground">
          {t(isAssignee ? "filters.assignment_fixed_hint" : "filters.creator_fixed_hint")}
        </Text>
      </>
    );
  }

  const store = useIssueListFilterStore.getState();
  const nobody = lockedByNobody(section, filters);
  const toggle = (key: ActorKey) =>
    isAssignee ? store.toggleAssignee(list, wsId, key) : store.toggleCreator(list, wsId, key);
  const meKey = userId ? actorKey("member", userId) : null;
  const { rows, hidden } = previewOptions(options, selected);

  return (
    <>
      <SectionLabel>{t(isAssignee ? "filters.assignment" : "filters.creator")}</SectionLabel>
      {isAssignee ? (
        <FilterRow
          checked={filters.involvesMe}
          label={t("filters.involves_me")}
          disabled={nobody}
          testID="filter-involves-me"
          onPress={() => store.setInvolvesMe(list, wsId, !filters.involvesMe)}
          icon={<Ionicons name="people-outline" size={16} color={muted} />}
        />
      ) : null}
      {meKey ? (
        <FilterRow
          checked={selected.includes(meKey)}
          label={t("filters.me")}
          a11yLabel={actorOptionA11yLabel(
            t("filters.me"),
            "member",
            selected.includes(meKey),
            t,
          )}
          disabled={nobody}
          onPress={() => toggle(meKey)}
          icon={<Ionicons name="person-outline" size={16} color={muted} />}
        />
      ) : null}
      {isAssignee ? (
        <>
          <FilterRow
            checked={filters.includeNoAssignee}
            label={t("filters.no_assignee")}
            onPress={() =>
              store.setIncludeNoAssignee(list, wsId, !filters.includeNoAssignee)
            }
            icon={<Ionicons name="remove-circle-outline" size={16} color={muted} />}
          />
          {nobody ? (
            <Text
              accessibilityLiveRegion="polite"
              className="px-4 pb-1 text-xs text-muted-foreground"
            >
              {t("filters.not_with_nobody")}
            </Text>
          ) : null}
          <Text className="px-4 pt-2 pb-1 text-xs text-muted-foreground">
            {t("filters.assignee_type")}
          </Text>
          <View className="flex-row flex-wrap gap-1.5 px-4 pb-1">
            {ASSIGNEE_TYPES.map((type) => {
              const checked = filters.assigneeTypes.includes(type);
              return (
                <Pressable
                  key={type}
                  testID={`assignee-type-${type}`}
                  disabled={nobody}
                  onPress={() => store.toggleAssigneeType(list, wsId, type)}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked, disabled: nobody }}
                  accessibilityLabel={`${t("filters.assignee_type")}: ${t(`filters.assignee_type_${type}`)}`}
                  className={cn(
                    "min-h-12 justify-center px-3 rounded-full border",
                    checked ? "border-primary bg-secondary" : "border-border",
                    nobody && "opacity-40",
                  )}
                >
                  <Text className="text-sm text-foreground">
                    {checked ? "✓ " : ""}
                    {t(`filters.assignee_type_${type}`)}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </>
      ) : null}
      {failed ? (
        <View className="flex-row flex-wrap items-center gap-3 px-4 py-2">
          <Text className="flex-1 text-sm text-destructive">
            {t("filters.people_load_failed")}
          </Text>
          <Pressable
            onPress={retry}
            accessibilityRole="button"
            className="min-h-12 justify-center px-2 active:opacity-60"
          >
            <Text className="text-sm text-primary font-medium">
              {t("common:actions.retry")}
            </Text>
          </Pressable>
        </View>
      ) : (
        <>
          {rows.map((o) => (
            <ActorRow
              key={o.key}
              option={o}
              checked={selected.includes(o.key)}
              disabled={nobody}
              onPress={() => toggle(o.key)}
            />
          ))}
          {hidden > 0 ? (
            <Pressable
              onPress={onShowAll}
              accessibilityRole="button"
              testID={`show-all-${section}`}
              className="flex-row items-center gap-2 px-4 min-h-12 active:bg-secondary"
            >
              <Text className="flex-1 text-sm text-primary font-medium">
                {t("filters.show_all", { count: options.length })}
              </Text>
              <Ionicons name="chevron-forward" size={16} color={muted} />
            </Pressable>
          ) : null}
        </>
      )}
    </>
  );
}

function ActorRow({
  option,
  checked,
  disabled,
  onPress,
  hidden = false,
}: {
  option: ActorOption;
  checked: boolean;
  disabled: boolean;
  onPress: () => void;
  /** Row of the dimmed "Hidden" section (W4). */
  hidden?: boolean;
}) {
  const { t } = useT("issues");
  return (
    <FilterRow
      checked={checked}
      label={option.name}
      hint={actorOptionHint(option.type, t, hidden)}
      a11yLabel={actorOptionA11yLabel(option.name, option.type, checked, t, hidden)}
      disabled={disabled}
      dimmed={hidden}
      onPress={onPress}
      icon={
        <ActorAvatar
          type={option.type}
          id={option.id}
          name={option.name}
          avatarUrl={option.avatarUrl}
          size={AVATAR_SIZE}
        />
      }
    />
  );
}

/**
 * Sub-screen behind "Show all (n)": every pickable actor of the section
 * with a search field. Replaces the sheet's list until "Back" (arrow or
 * Android back).
 */
export function ActorFilterPicker({
  section,
  list,
  wsId,
  userId,
  filters,
  onBack,
}: {
  section: FilterSection;
  list: IssueFilterList;
  wsId: string;
  userId: string | null;
  filters: IssueListFilters;
  onBack: () => void;
}) {
  const { t } = useT("issues");
  const { colorScheme } = useColorScheme();
  const [query, setQuery] = useState("");
  const isAssignee = section === "assignee";
  const { dir } = useActorDirectory(wsId, isAssignee);
  const hiddenActors = useHiddenForFilters(wsId);
  const selected = sectionValues(section, filters);
  const optionQuery = {
    userId,
    types: sectionTypes(section),
    selected,
    query,
    hidden: hiddenActors,
  };
  const options = actorOptions(dir, optionQuery);
  const hiddenMatches = hiddenActorOptions(dir, optionQuery);
  const store = useIssueListFilterStore.getState();
  const nobody = lockedByNobody(section, filters);
  const toggle = (key: ActorKey) =>
    isAssignee ? store.toggleAssignee(list, wsId, key) : store.toggleCreator(list, wsId, key);

  // Android back goes back to the sheet like the arrow, instead of closing
  // the whole sheet. Registered after the navigator's handler, so it runs
  // first.
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      onBack();
      return true;
    });
    return () => sub.remove();
  }, [onBack]);

  return (
    <View className="flex-1">
      <View className="flex-row items-center gap-2 px-2 pt-3 pb-2">
        <Pressable
          onPress={onBack}
          accessibilityRole="button"
          accessibilityLabel={t("filters.back")}
          hitSlop={8}
          className="size-12 items-center justify-center active:opacity-60"
        >
          <Ionicons
            name="arrow-back"
            size={20}
            color={THEME[colorScheme].foreground}
          />
        </Pressable>
        <Text
          accessibilityRole="header"
          className="flex-1 text-base font-semibold text-foreground"
        >
          {t(isAssignee ? "filters.people" : "filters.people_creator")}
        </Text>
      </View>
      <View className="px-4 pb-2">
        <TextField
          value={query}
          onChangeText={setQuery}
          placeholder={t("filters.search_people")}
          accessibilityLabel={t("filters.search_people")}
          autoCorrect={false}
          autoCapitalize="none"
          testID={`actor-search-${section}`}
        />
      </View>
      {nobody ? (
        <Text className="px-4 pb-1 text-xs text-muted-foreground">
          {t("filters.not_with_nobody")}
        </Text>
      ) : null}
      <FlatList
        data={options}
        keyExtractor={(o) => o.key}
        keyboardShouldPersistTaps="handled"
        renderItem={({ item }) => (
          <ActorRow
            option={item}
            checked={selected.includes(item.key)}
            disabled={nobody}
            onPress={() => toggle(item.key)}
          />
        )}
        ListEmptyComponent={
          hiddenMatches.length === 0 ? (
            <Text className="px-4 py-3 text-sm text-muted-foreground">
              {t("filters.no_matches")}
            </Text>
          ) : null
        }
        ListFooterComponent={
          hiddenMatches.length > 0 ? (
            <View testID={`hidden-actors-${section}`}>
              <SectionLabel>{t("filters.hidden_section")}</SectionLabel>
              {hiddenMatches.map((o) => (
                <ActorRow
                  key={o.key}
                  option={o}
                  checked={false}
                  disabled={nobody}
                  hidden
                  onPress={() => toggle(o.key)}
                />
              ))}
            </View>
          ) : null
        }
        contentContainerClassName="pb-6"
      />
    </View>
  );
}
