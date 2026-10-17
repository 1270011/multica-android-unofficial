/**
 * Squad detail, read-only: description and members with the
 * server-derived status (handler/squad.go deriveSquadMemberStatus) and the
 * issues each agent is working on. Leader first. Agent members open the
 * agent detail, active issues open the issue. Editing stays on the web.
 */
import { useMemo } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import type { SquadMemberStatusValue } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { ActorAvatar } from "@/components/ui/actor-avatar";
import { Skeleton } from "@/components/ui/skeleton";
import {
  squadDetailOptions,
  squadListOptions,
  squadMemberStatusOptions,
  squadMembersOptions,
} from "@/data/queries/squads";
import { useActorLookup } from "@/data/use-actor-name";
import { useWorkspaceStore } from "@/data/workspace-store";
import { squadMemberRows, type SquadMemberRow, SQUAD_ROW_MIN_DP } from "@/lib/agent-overview";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const STATUS_CLASS: Record<SquadMemberStatusValue, string> = {
  working: "text-primary",
  idle: "text-success",
  unstable: "text-warning",
  offline: "text-muted-foreground",
  archived: "text-muted-foreground",
};

export default function SquadDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useT("workspace");
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const { data: list } = useQuery(squadListOptions(wsId));
  const detail = useQuery(squadDetailOptions(wsId, id));
  const squad = detail.data ?? list?.find((s) => s.id === id);
  const members = useQuery(squadMembersOptions(wsId, id));
  const statuses = useQuery(squadMemberStatusOptions(wsId, id));

  const rows = useMemo(
    () =>
      squadMemberRows(
        members.data ?? [],
        statuses.data?.members ?? [],
        squad?.leader_id ?? "",
      ),
    [members.data, statuses.data, squad?.leader_id],
  );

  if (!squad) {
    return (
      <View className="flex-1 bg-background px-4 pt-6">
        <Stack.Screen options={{ title: t("agent.squad") }} />
        {detail.isLoading ? (
          <Skeleton className="h-5 w-1/2" />
        ) : (
          <Text className="text-sm text-muted-foreground">{t("agent.not_found")}</Text>
        )}
      </View>
    );
  }

  return (
    <ScrollView className="flex-1 bg-background" contentContainerClassName="pb-8">
      <Stack.Screen options={{ title: squad.name }} />
      <View className="flex-row items-center gap-3 px-4 pt-4">
        <ActorAvatar type="squad" id={squad.id} name={squad.name} avatarUrl={squad.avatar_url} size={48} />
        <View className="flex-1">
          <Text accessibilityRole="header" className="text-lg font-semibold text-foreground">
            {squad.name}
          </Text>
          <Text className="text-sm text-muted-foreground">
            {t("agent.member_count", { count: rows.length || squad.member_count || 0 })}
          </Text>
        </View>
      </View>
      {squad.description ? (
        <Text className="text-sm text-foreground px-4 pt-3">{squad.description}</Text>
      ) : null}

      <Text
        accessibilityRole="header"
        className="px-4 pt-5 pb-1 text-xs uppercase tracking-wider text-muted-foreground font-medium"
      >
        {t("agent.members")}
      </Text>
      {members.isLoading ? (
        <View className="px-4 gap-2">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-4 w-1/2" />
        </View>
      ) : rows.length === 0 ? (
        <Text className="px-4 text-sm text-muted-foreground">{t("agent.no_members")}</Text>
      ) : (
        rows.map((row) => <MemberRow key={row.key} row={row} />)
      )}
    </ScrollView>
  );
}

function MemberRow({ row }: { row: SquadMemberRow }) {
  const { t } = useT("workspace");
  const wsSlug = useWorkspaceStore((s) => s.currentWorkspaceSlug);
  const { getName } = useActorLookup();
  const name = getName(row.type, row.id);
  const statusText = row.status ? t(`agent.member_status.${row.status}`) : null;
  const meta = [
    row.isLeader ? t("agent.leader") : row.role || null,
    statusText,
  ]
    .filter(Boolean)
    .join(" · ");
  const isAgent = row.type === "agent";
  return (
    <View>
      <Pressable
        disabled={!isAgent}
        onPress={() => {
          if (wsSlug && isAgent) router.push(`/${wsSlug}/agent/${row.id}`);
        }}
        accessibilityRole={isAgent ? "button" : undefined}
        accessibilityLabel={meta ? `${name}, ${meta}` : name}
        className="flex-row items-center gap-3 px-4 py-2.5 min-h-12 active:bg-secondary"
      >
        <ActorAvatar type={row.type} id={row.id} size={32} showPresence={isAgent} />
        <View className="flex-1">
          <Text className="text-sm text-foreground" numberOfLines={1}>{name}</Text>
          {meta ? (
            <Text
              className={cn(
                "text-xs",
                row.status ? STATUS_CLASS[row.status] : "text-muted-foreground",
              )}
            >
              {meta}
            </Text>
          ) : null}
        </View>
      </Pressable>
      {row.activeIssues.map((issue) => (
        <Pressable
          key={issue.issue_id}
          onPress={() => {
            if (wsSlug) router.push(`/${wsSlug}/issue/${issue.issue_id}`);
          }}
          accessibilityRole="button"
          style={{ minHeight: SQUAD_ROW_MIN_DP }}
          className="pl-16 pr-4 py-1.5 justify-center active:bg-secondary"
        >
          <Text className="text-xs text-muted-foreground" numberOfLines={1}>
            {issue.identifier} · {issue.title}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}
