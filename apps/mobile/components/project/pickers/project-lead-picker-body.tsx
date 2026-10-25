/**
 * Pure picker body for project lead — single-select over members + agents
 * with an Unassigned row. Mirrors the assignee picker pattern: header +
 * search bar are owned by the iOS native nav header registered in
 * `app/(app)/[workspace]/_layout.tsx`; the route wires `query` in via
 * `useNativeSearchBar` and passes it through. Body is a pure FlatList.
 *
 * Flat list with inline "Agent" right-aligned tag — matches Apple's
 * UITableViewCellStyleValue1 pattern (used throughout Settings); at this
 * row count (~10–30) inline tag beats SectionList headers (which would
 * eat ~8% of the sheet height).
 *
 * People and agents hidden in Settings › View are left out
 * unless they are the lead; a search lists them dimmed under "Hidden"
 * (`useVisibleActors`).
 */
import { useMemo } from "react";
import { FlatList, Pressable, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { Ionicons } from "@/components/ui/ionicons";
import { useColorScheme } from "nativewind";
import type { Agent, MemberWithUser } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { ActorAvatar } from "@/components/ui/actor-avatar";
import { MOBILE_PLACEHOLDER_COLOR } from "@/components/ui/input-tokens";
import { agentListOptions } from "@/data/queries/agents";
import { memberListOptions } from "@/data/queries/members";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useScrollToTopOnChange } from "@/lib/use-scroll-to-top-on-change";
import { THEME } from "@/lib/theme";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { useVisibleActors } from "@/lib/use-visible-actors";
import { type PickerActorRef, withHiddenNote } from "@/lib/visible-actors";
import { PickerHiddenSection } from "@/components/issue/pickers/picker-hidden-section";

const AVATAR_SIZE = 36;

export interface LeadValue {
  type: "member" | "agent";
  id: string;
}

interface Props {
  value: LeadValue | null;
  query: string;
  onChange: (next: LeadValue | null) => void;
}

type Row =
  | { kind: "unassigned" }
  | { kind: "hidden_section" }
  | { kind: "member"; member: MemberWithUser; hidden?: boolean }
  | { kind: "agent"; agent: Agent; hidden?: boolean };

function actorRef(row: Row): PickerActorRef | null {
  if (row.kind === "member") return { type: "member", id: row.member.user_id };
  if (row.kind === "agent") return { type: "agent", id: row.agent.id };
  return null;
}

function isRowSelected(value: LeadValue | null, row: Row): boolean {
  if (row.kind === "unassigned") return value === null;
  if (value === null || row.kind === "hidden_section") return false;
  if (row.kind === "member")
    return value.type === "member" && value.id === row.member.user_id;
  return value.type === "agent" && value.id === row.agent.id;
}

export function ProjectLeadPickerBody({ value, query, onChange }: Props) {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const { t } = useT("issues");
  const { data: members = [] } = useQuery(memberListOptions(wsId));
  const { data: agents = [] } = useQuery(agentListOptions(wsId));
  const visibleActors = useVisibleActors(wsId);
  const listRef = useScrollToTopOnChange(query);
  const { colorScheme } = useColorScheme();
  const checkColor =
    colorScheme === "dark" ? THEME.dark.primary : THEME.light.primary;

  const rows = useMemo<Row[]>(() => {
    const q = query.trim().toLowerCase();
    const matchName = (n: string) => !q || n.toLowerCase().includes(q);

    const opts = { selected: value ? [value] : [], query };
    const people = visibleActors.split(
      [...members]
        .filter((m) => matchName(m.name))
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((m): Row => ({ kind: "member", member: m })),
      actorRef,
      opts,
    );
    const bots = visibleActors.split(
      [...agents]
        .filter((a) => matchName(a.name))
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((a): Row => ({ kind: "agent", agent: a })),
      actorRef,
      opts,
    );
    const memberRows = people.visible;
    const agentRows = bots.visible;

    if (q) {
      const dimmed = [...people.hidden, ...bots.hidden].map(
        (r): Row => ({ ...r, hidden: true }) as Row,
      );
      return [
        ...memberRows,
        ...agentRows,
        ...(dimmed.length > 0 ? [{ kind: "hidden_section" } as Row, ...dimmed] : []),
      ];
    }

    const all = [...memberRows, ...agentRows];
    const selectedRow = all.find((r) => isRowSelected(value, r));
    return [
      { kind: "unassigned" },
      ...(selectedRow ? [selectedRow] : []),
      ...memberRows.filter((r) => !isRowSelected(value, r)),
      ...agentRows.filter((r) => !isRowSelected(value, r)),
    ];
  }, [members, agents, query, value, visibleActors]);

  const select = (row: Row) => {
    if (row.kind === "hidden_section") return;
    if (row.kind === "unassigned") onChange(null);
    else if (row.kind === "member")
      onChange({ type: "member", id: row.member.user_id });
    else onChange({ type: "agent", id: row.agent.id });
  };

  return (
    <FlatList
      ref={listRef}
      data={rows}
      className="flex-1"
      keyboardShouldPersistTaps="handled"
      automaticallyAdjustKeyboardInsets
      contentInsetAdjustmentBehavior="automatic"
      keyExtractor={(row) => {
        if (row.kind === "unassigned") return "unassigned";
        if (row.kind === "hidden_section") return "hidden_section";
        if (row.kind === "member") return `m:${row.member.user_id}`;
        return `a:${row.agent.id}`;
      }}
      renderItem={({ item }) => {
        if (item.kind === "hidden_section") {
          return <PickerHiddenSection label={t("picker.hidden_section")} />;
        }
        const dimmed = item.kind !== "unassigned" && !!item.hidden;
        return (
        <Pressable
          onPress={() => select(item)}
          accessibilityHint={dimmed ? t("picker.hidden_note") : undefined}
          className={cn(
            "flex-row items-center gap-3 px-4 py-3 active:bg-secondary",
            dimmed && "opacity-50",
          )}
        >
          {item.kind === "unassigned" ? (
            <View
              className="rounded-full border border-dashed border-muted-foreground/40 items-center justify-center"
              style={{ width: AVATAR_SIZE, height: AVATAR_SIZE }}
            >
              <Ionicons
                name="close-circle-outline"
                size={20}
                color={MOBILE_PLACEHOLDER_COLOR}
              />
            </View>
          ) : item.kind === "member" ? (
            <ActorAvatar
              type="member"
              id={item.member.user_id}
              size={AVATAR_SIZE}
              showPresence
            />
          ) : (
            <ActorAvatar
              type="agent"
              id={item.agent.id}
              size={AVATAR_SIZE}
              showPresence
            />
          )}
          <Text
            className="flex-1 text-base text-foreground"
            numberOfLines={1}
          >
            {item.kind === "unassigned"
              ? t("picker.unassigned")
              : item.kind === "member"
                ? item.member.name
                : item.agent.name}
          </Text>
          {/* Inline type tag — Apple UITableViewCellStyleValue1. */}
          {item.kind === "agent" ? (
            <Text className="text-sm text-muted-foreground">
              {withHiddenNote(t("picker.agent"), dimmed, t)}
            </Text>
          ) : dimmed ? (
            <Text className="text-sm text-muted-foreground">
              {t("picker.hidden_note")}
            </Text>
          ) : null}
          {isRowSelected(value, item) ? (
            <Ionicons name="checkmark" size={20} color={checkColor} />
          ) : null}
        </Pressable>
        );
      }}
      ListEmptyComponent={
        <View className="px-3 py-8 items-center">
          <Text className="text-sm text-muted-foreground text-center">
            {query
              ? t("picker.no_matches")
              : t("picker.no_members_agents")}
          </Text>
        </View>
      }
    />
  );
}
