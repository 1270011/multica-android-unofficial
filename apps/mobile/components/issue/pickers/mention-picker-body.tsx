/**
 * Pure picker body for the comment composer's @mention chips.
 *
 * Mirrors `LabelPickerBody`: multi-select with tap-to-toggle, sheet stays
 * open across toggles, user dismisses via grabber drag-down, Back or the
 * pinned "Done (n)" button. Picks show as chips in a fixed bar above the
 * list (W3-P2), so earlier picks never need scrolling back to.
 * A pick made with search text empties the search (focus and keyboard
 * stay) so the next name can be typed at once; without search text the
 * list holds its position and picked rows never move (W3-P3).
 *
 * Sections (alphabetical within each, except Frequent):
 *   1. `@all` (pinned top, filtered by query)
 *   2. Frequent (sort mode "Most mentioned" with history: up to 8 people,
 *      agents and squads, most mentioned first; they leave their own
 *      section. W6-P10, lib/mention-frequent.ts)
 *   3. People
 *   4. Agents
 *   5. Squads (archived hidden)
 *   6. Hidden (only while searching: people and agents hidden in
 *      Settings › View, dimmed but pickable; W4, A4.3)
 *   7. Issues (server-side `api.searchIssues`, debounced 200ms; empty
 *      query → no issues section, matching web's mention-suggestion.tsx)
 *
 * Mobile is the iOS-native equivalent of shadcn's `CommandDialog` — search
 * input from the native UISearchController (registered by the parent
 * route via `useNativeSearchBar`), groups via uppercase section labels,
 * empty state inline. Android shows no sheet header, so there the route
 * passes its own field as `searchField`, rendered above the chip bar
 *.
 *
 * Hidden people and agents (W4) are left out of People/Agents unless they
 * are picked. Anything picked while the sheet is open stays listed until
 * it closes, so unticking a hidden one does not make its row vanish
 * (W3-P3: rows never move on a pick). The mention counts are read once
 * when the sheet opens, so "Frequent" never reorders while it is open
 * (W6, A6.5).
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  AccessibilityInfo,
  FlatList,
  Platform,
  Pressable,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { router } from "expo-router";
import { useKeyboardState } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery } from "@tanstack/react-query";
import { Ionicons } from "@/components/ui/ionicons";
import { useColorScheme } from "nativewind";
import type {
  Agent,
  Issue,
  MemberWithUser,
  Squad,
} from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { ActorAvatar } from "@/components/ui/actor-avatar";
import { StatusIcon } from "@/components/ui/status-icon";
import { issueColumnCategory } from "@/lib/issue-status";
import { useIssueStatuses } from "@/lib/use-issue-statuses";
import { memberListOptions } from "@/data/queries/members";
import { agentListOptions } from "@/data/queries/agents";
import { squadListOptions } from "@/data/queries/squads";
import { api } from "@/data/api";
import { useWorkspaceStore } from "@/data/workspace-store";
import {
  useMentionDraftStore,
  type MentionChipDraft,
  type MentionTargetType,
} from "@/data/stores/mention-draft-store";
import {
  MentionDoneBar,
  MentionSelectionBar,
} from "@/components/issue/pickers/mention-picker-selection";
import {
  compensateScrollForBar,
  mentionKeyboardSpacer,
  mentionToggleAnnouncement,
  shouldClearQueryAfterToggle,
} from "@/lib/mention-picker-selection";
import { useScrollToTopOnChange } from "@/lib/use-scroll-to-top-on-change";
import { THEME } from "@/lib/theme";
import { isAgentRuntimeBound } from "@/lib/is-agent-runtime-bound";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n";
import { useVisibleActors } from "@/lib/use-visible-actors";
import { type PickerActorRef, withHiddenNote } from "@/lib/visible-actors";
import { PickerHiddenSection } from "@/components/issue/pickers/picker-hidden-section";
import { splitFrequent, type FrequentKey } from "@/lib/mention-frequent";
import { type MentionUsage, mentionUsageKey, readMentionUsage } from "@/lib/mention-usage";
import { useMentionSortMode } from "@/data/stores/view-prefs-store";

const AVATAR_SIZE = 36;

function actorRef(row: Row): PickerActorRef | null {
  if (row.kind === "member") return { type: "member", id: row.member.user_id };
  if (row.kind === "agent") return { type: "agent", id: row.agent.id };
  return null;
}

function frequentKey(row: Row): FrequentKey | null {
  if (row.kind === "member")
    return { key: mentionUsageKey("member", row.member.user_id), name: row.member.name };
  if (row.kind === "agent")
    return { key: mentionUsageKey("agent", row.agent.id), name: row.agent.name };
  if (row.kind === "squad")
    return { key: mentionUsageKey("squad", row.squad.id), name: row.squad.name };
  return null;
}

/** `frequentIndex`: position in the "Frequent" section (W6-P10). */
type Row =
  | { kind: "section"; label: string; frequent?: boolean }
  | { kind: "hidden_section" }
  | { kind: "all" }
  | { kind: "member"; member: MemberWithUser; hidden?: boolean; frequentIndex?: number }
  | { kind: "agent"; agent: Agent; hidden?: boolean; frequentIndex?: number }
  | { kind: "squad"; squad: Squad; frequentIndex?: number }
  | { kind: "issue"; issue: Issue };

interface Props {
  query: string;
  /** "comment" (default) renders @all + People + Agents + Squads + Issues.
   *  "chat" hides the people-style sections (member / agent / squad /
   *  @all) because chat is user ↔ single agent — mentioning a person
   *  there generates unintended notifications. Only Issues remain useful
   *  in chat as "reference this ticket for context". */
  mode?: "comment" | "chat";
  /** Empties the route's search field, keeping focus (W3-P3). */
  onClearQuery?: () => void;
  /** In-body search field (Android); iOS uses the header. */
  searchField?: ReactNode;
}

export function MentionPickerBody({
  query,
  mode = "comment",
  onClearQuery,
  searchField,
}: Props) {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const { t } = useT("issues");
  // Rows are icon-only here too — colour is what names a custom status.
  const catalog = useIssueStatuses();
  const { data: members = [] } = useQuery(memberListOptions(wsId));
  const { data: agents = [] } = useQuery(agentListOptions(wsId));
  const { data: squads = [] } = useQuery(squadListOptions(wsId));
  const runnableAgentIds = useMemo(
    () =>
      new Set(
        agents
          .filter((agent) => !agent.archived_at && isAgentRuntimeBound(agent))
          .map((agent) => agent.id),
      ),
    [agents],
  );
  const listRef = useScrollToTopOnChange(query);

  // W3-P3 "list does not jump": rows never reorder on a pick (`rows` does
  // not depend on the selection), but the selection bar appearing or
  // vanishing above the list shifts it by the bar's height. Scroll by the
  // same amount so the row under the finger stays put.
  const scrollOffset = useRef(0);
  const barHeight = useRef(0);
  const skipBarCompensation = useRef(false);
  const onListScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    scrollOffset.current = e.nativeEvent.contentOffset.y;
  };
  const onBarLayout = (e: LayoutChangeEvent) => {
    const next = e.nativeEvent.layout.height;
    const target = skipBarCompensation.current
      ? null
      : compensateScrollForBar(scrollOffset.current, barHeight.current, next);
    barHeight.current = next;
    skipBarCompensation.current = false;
    if (target !== null) {
      scrollOffset.current = target;
      listRef.current?.scrollToOffset({ offset: target, animated: false });
    }
  };
  const { colorScheme } = useColorScheme();
  const checkColor =
    colorScheme === "dark" ? THEME.dark.primary : THEME.light.primary;

  const selected = useMentionDraftStore((s) => s.mentions);
  const toggle = useMentionDraftStore((s) => s.toggle);
  // W4: picked people/agents stay listed even when hidden. Grow-only while
  // the sheet is open, so `rows` need not depend on the selection.
  const visibleActors = useVisibleActors(wsId);
  const keptRefs = useRef<PickerActorRef[]>([]);
  for (const m of selected) {
    if (m.type !== "member" && m.type !== "agent") continue;
    if (!keptRefs.current.some((r) => r.type === m.type && r.id === m.id)) {
      keptRefs.current.push({ type: m.type, id: m.id });
    }
  }
  const splitKept = useCallback(
    (items: Row[]) =>
      visibleActors.split(items, actorRef, { selected: keptRefs.current, query }),
    [visibleActors, query],
  );
  // W6-P10: counts frozen at open (they only change after a send anyway).
  const sortMode = useMentionSortMode();
  const [usage] = useState<MentionUsage>(() => (wsId ? readMentionUsage(wsId) : {}));
  const keyboardOpen = useKeyboardState((s) => s.isVisible);
  const keyboardHeight = useKeyboardState((s) => s.height);
  const insets = useSafeAreaInsets();
  const keyboardSpacer = mentionKeyboardSpacer(
    Platform.OS,
    keyboardOpen,
    keyboardHeight,
    insets.bottom,
  );

  // Toggle + TalkBack phrase "ux-designer added, 2 selected" (A3.6). Row
  // taps and chip taps both go through here.
  const toggleAndAnnounce = (chip: MentionChipDraft) => {
    const added = !selected.some(
      (m) => m.type === chip.type && m.id === chip.id,
    );
    toggle(chip);
    // W3-P3: a pick from a search result empties the search; the list
    // goes back to the top (useScrollToTopOnChange), which is wanted here,
    // so the bar compensation below must not fight it. Only the first pick
    // makes the bar appear (and fire onLayout), so only then skip.
    if (onClearQuery && shouldClearQueryAfterToggle(query, added)) {
      skipBarCompensation.current = selected.length === 0;
      onClearQuery();
    }
    AccessibilityInfo.announceForAccessibility(
      mentionToggleAnnouncement(
        t,
        chip,
        added,
        selected.length + (added ? 1 : -1),
      ),
    );
  };

  // Server-side issue search (mirrors web's mention-suggestion.tsx). Empty
  // query → no fetch + no issues section. Debounced 200ms; in-flight
  // cancelled on every keystroke via AbortController.
  const [issueResults, setIssueResults] = useState<Issue[]>([]);
  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setIssueResults([]);
      return;
    }
    const ac = new AbortController();
    const timer = setTimeout(() => {
      void api
        .searchIssues(
          { q: trimmed, limit: 8, include_closed: false },
          { signal: ac.signal },
        )
        .then((res) => setIssueResults(res.issues))
        .catch(() => setIssueResults([]));
    }, 200);
    return () => {
      ac.abort();
      clearTimeout(timer);
    };
  }, [query]);

  const isSelectedKey = (type: MentionTargetType, id: string) =>
    selected.some((m) => m.type === type && m.id === id);

  const isSelected = (row: Row): boolean => {
    if (row.kind === "section" || row.kind === "hidden_section") return false;
    if (row.kind === "all") return isSelectedKey("all", "all");
    if (row.kind === "member")
      return isSelectedKey("member", row.member.user_id);
    if (row.kind === "agent") return isSelectedKey("agent", row.agent.id);
    if (row.kind === "squad") return isSelectedKey("squad", row.squad.id);
    return isSelectedKey("issue", row.issue.id);
  };

  const rows = useMemo<Row[]>(() => {
    const q = query.trim().toLowerCase();
    const matchName = (name: string) => !q || name.toLowerCase().includes(q);

    const out: Row[] = [];

    // People-style sections only render in comment mode. Chat is single-
    // agent; @张三 / @squad / @all there are noise + notify the wrong
    // people. The Issues section IS useful in chat ("reference ticket
    // for context"), so it stays for both modes.
    if (mode === "comment") {
      if (!q || "all".includes(q)) {
        out.push({ kind: "all" });
      }
      const people = splitKept(
        [...members]
          .filter((m) => matchName(m.name))
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((m): Row => ({ kind: "member", member: m })),
      );
      const bots = splitKept(
        [...agents]
          .filter((a) => matchName(a.name))
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((a): Row => ({ kind: "agent", agent: a })),
      );
      const squadList = [...squads]
        .filter((s) => !s.archived_at && matchName(s.name))
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((s): Row => ({ kind: "squad", squad: s }));
      const {
        frequent,
        sections: [memberRows = [], agentRows = [], squadRows = []],
      } = splitFrequent([people.visible, bots.visible, squadList], frequentKey, usage, {
        mode: sortMode,
        isHidden: (row) => {
          const ref = actorRef(row);
          return !!ref && visibleActors.isHidden(ref);
        },
        isEligible: (row) =>
          row.kind === "agent"
            ? !row.agent.archived_at && isAgentRuntimeBound(row.agent)
            : row.kind === "squad"
              ? runnableAgentIds.has(row.squad.leader_id)
              : true,
      });
      if (frequent.length > 0) {
        out.push(
          { kind: "section", label: t("picker.frequent"), frequent: true },
          ...frequent.map((r, i): Row => ({ ...r, frequentIndex: i }) as Row),
        );
      }
      if (memberRows.length > 0) {
        out.push({ kind: "section", label: t("picker.people") }, ...memberRows);
      }
      if (agentRows.length > 0) {
        out.push({ kind: "section", label: t("picker.agents") }, ...agentRows);
      }
      if (squadRows.length > 0) {
        out.push({ kind: "section", label: t("picker.squads") }, ...squadRows);
      }
      const dimmed = [...people.hidden, ...bots.hidden];
      if (dimmed.length > 0) {
        out.push(
          { kind: "hidden_section" },
          ...dimmed.map((r): Row => ({ ...r, hidden: true }) as Row),
        );
      }
    }

    if (issueResults.length > 0) {
      out.push({ kind: "section", label: t("picker.issues") });
      for (const i of issueResults) {
        out.push({ kind: "issue", issue: i });
      }
    }
    return out;
  }, [
    mode,
    members,
    agents,
    squads,
    issueResults,
    query,
    t,
    splitKept,
    usage,
    sortMode,
    visibleActors,
    runnableAgentIds,
  ]);

  const pick = (row: Row) => {
    let chip: MentionChipDraft | null = null;
    if (row.kind === "all") chip = { type: "all", id: "all", name: "all" };
    else if (row.kind === "member")
      chip = {
        type: "member",
        id: row.member.user_id,
        name: row.member.name,
      };
    else if (row.kind === "agent")
      chip = { type: "agent", id: row.agent.id, name: row.agent.name };
    else if (row.kind === "squad")
      chip = { type: "squad", id: row.squad.id, name: row.squad.name };
    else if (row.kind === "issue")
      chip = {
        type: "issue",
        id: row.issue.id,
        name: row.issue.identifier,
      };
    if (chip) toggleAndAnnounce(chip);
  };

  // The route registers a native header (search bar), so the #3634
  // formSheet header-offset workaround (FlatList as the route's direct
  // child) does not apply here. The wrapper holds the search field (Android)
  // and the fixed selection bar above and the Done button below the list.
  return (
    <View className="flex-1 bg-background">
      {searchField}
      <View onLayout={onBarLayout}>
        <MentionSelectionBar selected={selected} onRemove={toggleAndAnnounce} />
      </View>
      <FlatList
        testID="mention-picker-list"
        ref={listRef}
        onScroll={onListScroll}
        scrollEventThrottle={16}
        data={rows}
        className="flex-1"
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
        contentInsetAdjustmentBehavior="automatic"
        keyExtractor={(row, idx) => {
          if (row.kind === "section") return `section:${row.label}:${idx}`;
          if (row.kind === "hidden_section") return "hidden_section";
          if (row.kind === "all") return "all";
          if (row.kind === "member") return `m:${row.member.user_id}`;
          if (row.kind === "agent") return `a:${row.agent.id}`;
          if (row.kind === "squad") return `s:${row.squad.id}`;
          return `i:${row.issue.id}`;
        }}
        renderItem={({ item }) => {
          if (item.kind === "section") {
            return (
              <View
                testID={item.frequent ? "picker-frequent-section" : undefined}
                accessibilityRole="header"
                className="px-4 pt-4 pb-1"
              >
                <Text className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  {item.label}
                </Text>
              </View>
            );
          }
          if (item.kind === "hidden_section") {
            return <PickerHiddenSection label={t("picker.hidden_section")} />;
          }
          const dimmed =
            (item.kind === "member" || item.kind === "agent") && !!item.hidden;
          const needsRuntime =
            (item.kind === "agent" && !isAgentRuntimeBound(item.agent)) ||
            (item.kind === "squad" &&
              !runnableAgentIds.has(item.squad.leader_id));
          return (
            <Pressable
              testID={dimmed ? `mention-row-${item.kind}-hidden` : `mention-row-${item.kind}`}
              disabled={needsRuntime}
              onPress={() => pick(item)}
              accessibilityRole="checkbox"
              accessibilityState={{
                checked: isSelected(item),
                disabled: needsRuntime,
              }}
              accessibilityHint={dimmed ? t("picker.hidden_note") : undefined}
              className={cn(
                "flex-row items-center gap-3 px-4 py-3 active:bg-secondary",
                (needsRuntime || dimmed) && "opacity-50",
              )}
            >
              {item.kind === "all" ? (
                <View
                  className="rounded-full bg-primary/10 items-center justify-center"
                  style={{ width: AVATAR_SIZE, height: AVATAR_SIZE }}
                >
                  <Ionicons name="people" size={20} color={checkColor} />
                </View>
              ) : item.kind === "member" ? (
                <ActorAvatar
                  type="member"
                  id={item.member.user_id}
                  size={AVATAR_SIZE}
                />
              ) : item.kind === "agent" ? (
                <ActorAvatar type="agent" id={item.agent.id} size={AVATAR_SIZE} />
              ) : item.kind === "squad" ? (
                <ActorAvatar type="squad" id={item.squad.id} size={AVATAR_SIZE} />
              ) : (
                <View
                  className="items-center justify-center"
                  style={{ width: AVATAR_SIZE, height: AVATAR_SIZE }}
                >
                  <StatusIcon
                    status={item.issue.status}
                    category={issueColumnCategory(item.issue)}
                    icon={catalog.iconOf(item.issue.status)} color={catalog.colorOf(item.issue.status)}
                    size={22}
                  />
                </View>
              )}
              {item.kind === "issue" ? (
                <View className="flex-1 flex-row items-center gap-2">
                  <Text className="text-sm font-medium text-muted-foreground">
                    {item.issue.identifier}
                  </Text>
                  <Text
                    className="flex-1 text-base text-foreground"
                    numberOfLines={1}
                  >
                    {item.issue.title}
                  </Text>
                </View>
              ) : (
                <Text
                  testID={
                    item.kind !== "all" && item.frequentIndex !== undefined
                      ? `mention-frequent-name-${item.frequentIndex}`
                      : undefined
                  }
                  className="flex-1 text-base text-foreground"
                >
                  {item.kind === "all"
                    ? t("picker.everyone")
                    : item.kind === "member"
                      ? item.member.name
                      : item.kind === "agent"
                        ? item.agent.name
                        : item.squad.name}
                </Text>
              )}
              {item.kind === "agent" ? (
                <Text className="text-sm text-muted-foreground">
                  {withHiddenNote(
                    isAgentRuntimeBound(item.agent)
                      ? t("picker.agent")
                      : t("picker.needs_runtime"),
                    dimmed,
                    t,
                  )}
                </Text>
              ) : item.kind === "member" && dimmed ? (
                <Text className="text-sm text-muted-foreground">
                  {t("picker.hidden_note")}
                </Text>
              ) : item.kind === "squad" ? (
                <Text className="text-sm text-muted-foreground">
                  {needsRuntime
                    ? t("picker.leader_needs_runtime")
                    : t("picker.squad")}
                </Text>
              ) : null}
              {isSelected(item) ? (
                <Ionicons name="checkmark" size={20} color={checkColor} />
              ) : null}
            </Pressable>
          );
        }}
        ListEmptyComponent={
          <View className="px-3 py-8 items-center">
            <Text className="text-sm text-muted-foreground">
              {t("picker.no_matches")}
            </Text>
          </View>
        }
      />
      <MentionDoneBar
        count={selected.length}
        keyboardOpen={keyboardOpen}
        onDone={() => router.back()}
      />
      {/* Android: keeps Done above the keyboard. */}
      <View style={{ height: keyboardSpacer }} />
    </View>
  );
}
