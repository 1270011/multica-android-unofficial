/**
 * Inbox filter sheet: status, priority and "From" (actor).
 * Presented as a formSheet like `issues-filter.tsx`; web parity with
 * packages/views/inbox/components/inbox-filter-menu.tsx (faceted counts,
 * actors offered from the list, priority hidden on an older backend).
 *
 *   /[workspace]/inbox-filter?view=all|unread
 *
 * `view` is the Inbox segment the sheet was opened from, so the counts
 * describe the list behind the sheet. Self-contained: reads the inbox cache
 * and writes `useInboxFilterStore` directly.
 */
import { useMemo } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import type { IssuePriority } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { StatusIcon } from "@/components/ui/status-icon";
import { PriorityIcon } from "@/components/ui/priority-icon";
import { ActorAvatar } from "@/components/ui/actor-avatar";
import { inboxListOptions } from "@/data/queries/inbox";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useActorLookup } from "@/data/use-actor-name";
import {
  useInboxFilters,
  useInboxFilterStore,
} from "@/data/stores/inbox-filter-store";
import { deduplicateInboxItems, filterInboxView } from "@/lib/inbox-display";
import {
  effectiveInboxFilters,
  inboxActorKeyParts,
  inboxActorOptions,
  inboxFacets,
  inboxFilterCount,
  inboxStatusKeys,
  inboxSupportsPriority,
  INBOX_PRIORITY_ORDER,
  type InboxFilterDimension,
} from "@/lib/inbox-filters";
import { statusOptions } from "@/lib/issue-status";
import { useIssueStatuses } from "@/lib/use-issue-statuses";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const PRIORITY_LABEL: Record<IssuePriority, string> = {
  urgent: "issues:priority.urgent",
  high: "issues:priority.high",
  medium: "issues:priority.medium",
  low: "issues:priority.low",
  none: "issues:priority.none",
};

export default function InboxFilterRoute() {
  const { view } = useLocalSearchParams<{ view?: string }>();
  const { t } = useT("inbox");
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const filters = useInboxFilters(wsId);
  const { data: live } = useQuery(inboxListOptions(wsId));
  const catalog = useIssueStatuses();
  const { getName } = useActorLookup();

  const items = useMemo(
    () =>
      filterInboxView(
        deduplicateInboxItems(live ?? []),
        view === "unread" ? "unread" : "all",
      ),
    [live, view],
  );
  const prioritySupported = inboxSupportsPriority(live ?? []);
  const effective = effectiveInboxFilters(filters, prioritySupported);
  const facets = useMemo(() => inboxFacets(items, effective), [items, effective]);

  // Catalog order for statuses the list carries (plus selected ones); keys
  // the catalog does not know go last with their raw label.
  const statusChoices = useMemo(() => {
    const present = new Set(inboxStatusKeys(items, filters.statuses));
    const ordered = statusOptions(catalog).filter((o) => present.has(o.key));
    for (const o of ordered) present.delete(o.key);
    return [
      ...ordered,
      ...[...present].map((key) => ({
        key,
        category: catalog.categoryOf(key),
        label: catalog.labelOf(key),
        color: catalog.colorOf(key),
        icon: catalog.iconOf(key),
      })),
    ];
  }, [items, filters.statuses, catalog]);

  // Sorted by name so the list does not reshuffle while counts change.
  const actorChoices = useMemo(
    () =>
      inboxActorOptions(items, filters.actors)
        .map((key) => {
          const { type, id } = inboxActorKeyParts(key);
          const name =
            type === "system"
              ? "Multica"
              : getName(type as "member" | "agent", id);
          return { key, type, id, name };
        })
        .sort((a, b) => a.name.localeCompare(b.name)),
    [items, filters.actors, getName],
  );

  if (!wsId) return null;
  const toggle = (dimension: InboxFilterDimension, value: string) =>
    useInboxFilterStore.getState().toggle(wsId, dimension, value);
  // Counts the effective filters, like the Inbox button: a dormant priority
  // selection (older server) shows no "Clear" next to a button saying 0.
  const hasActive = inboxFilterCount(effective) > 0;

  return (
    <View className="flex-1">
      <View className="flex-row items-center justify-between px-4 pt-4 pb-3">
        <Text className="text-base font-semibold text-foreground">
          {t("filter_sheet.title")}
        </Text>
        {hasActive ? (
          <Pressable
            onPress={() => useInboxFilterStore.getState().clear(wsId)}
            hitSlop={8}
            accessibilityRole="button"
            className="px-2 py-1 active:opacity-60"
          >
            <Text className="text-sm text-primary font-medium">
              {t("filter_sheet.clear")}
            </Text>
          </Pressable>
        ) : null}
      </View>
      <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
        {statusChoices.length === 0 && actorChoices.length === 0 ? (
          <Text className="px-4 py-3 text-sm text-muted-foreground">
            {t("filter_sheet.nothing_to_filter")}
          </Text>
        ) : null}

        {statusChoices.length > 0 ? (
          <SectionLabel>{t("filter_sheet.status")}</SectionLabel>
        ) : null}
        {statusChoices.map((option) => (
          <FilterRow
            key={option.key}
            checked={filters.statuses.includes(option.key)}
            label={option.label}
            count={facets.statuses.get(option.key) ?? 0}
            onPress={() => toggle("statuses", option.key)}
            icon={
              <StatusIcon
                status={option.key}
                category={option.category}
                icon={option.icon}
                color={option.color}
                size={16}
              />
            }
          />
        ))}

        {prioritySupported ? (
          <>
            <SectionLabel>{t("filter_sheet.priority")}</SectionLabel>
            {INBOX_PRIORITY_ORDER.map((priority) => (
              <FilterRow
                key={priority}
                checked={filters.priorities.includes(priority)}
                label={t(PRIORITY_LABEL[priority])}
                count={facets.priorities.get(priority) ?? 0}
                onPress={() => toggle("priorities", priority)}
                icon={<PriorityIcon priority={priority} />}
              />
            ))}
          </>
        ) : null}

        {actorChoices.length > 0 ? (
          <SectionLabel>{t("filter_sheet.from")}</SectionLabel>
        ) : null}
        {actorChoices.map((actor) => (
          <FilterRow
            key={actor.key}
            checked={filters.actors.includes(actor.key)}
            label={actor.name}
            count={facets.actors.get(actor.key) ?? 0}
            onPress={() => toggle("actors", actor.key)}
            icon={
              <ActorAvatar
                type={actor.type as "member" | "agent" | "system"}
                id={actor.id || null}
                size={20}
              />
            }
          />
        ))}
        <View className="h-6" />
      </ScrollView>
    </View>
  );
}

function FilterRow({
  checked,
  label,
  count,
  icon,
  onPress,
}: {
  checked: boolean;
  label: string;
  count: number;
  icon: React.ReactNode;
  onPress: () => void;
}) {
  const { t } = useT("inbox");
  const countLabel = t("filter_sheet.count", { count });
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      accessibilityLabel={`${label}, ${countLabel}`}
      className={cn(
        "flex-row items-center gap-3 px-4 py-2.5 min-h-12 active:bg-secondary",
        checked && "bg-secondary/60",
      )}
    >
      {icon}
      <Text className="flex-1 text-sm text-foreground">{label}</Text>
      {count > 0 ? (
        <Text className="text-xs text-muted-foreground tabular-nums">
          {count}
        </Text>
      ) : null}
      <Text
        className={cn(
          "w-4 text-sm text-primary font-semibold",
          !checked && "opacity-0",
        )}
      >
        ✓
      </Text>
    </Pressable>
  );
}

function SectionLabel({ children }: { children: string }) {
  return (
    <View className="px-4 pt-3 pb-1.5">
      <Text
        accessibilityRole="header"
        className="text-xs uppercase tracking-wider text-muted-foreground font-medium"
      >
        {children}
      </Text>
    </View>
  );
}
