/**
 * Pinned items list — mirrors the role of web's sidebar "Pinned" section
 * (packages/views/layout/app-sidebar.tsx PinnedItemRow), one screen up the
 * navigation tree because phones have no sidebar.
 *
 * Architecture invariant (matches web): `PinnedItem` only carries metadata
 * (`item_type` + `item_id`). Title / status / icon are fetched per-row via
 * `issueDetailOptions` / `projectDetailOptions`, so when an issue's status
 * or a project's title changes via `issue:updated` / `project:updated`,
 * this list updates automatically — no cross-entity invalidate on pinKeys
 * is needed. Do NOT inline the display fields into the pin row; that
 * couples this view to a stale snapshot. See packages/core/types/pin.ts
 * top comment.
 *
 * Rendering split by `item_type`:
 *   - issue → existing `<IssueRow>` (used by my-issues / more/issues /
 *     project-related-issues), `showStatus` because pins are heterogeneous
 *     (no section grouping by status).
 *   - project → existing `<ProjectRow>` (used by more/projects).
 *   - view → name of the saved view; a tap applies the view
 *     and opens My Issues with its filters (lib/view-pins.ts). A view that
 *     is gone (404 / unreadable) gets the placeholder; any other error hides
 *     the row, so a server hiccup never offers to unpin a live view.
 *
 * Missing / no-permission rows: the detail query may 404 (issue/project
 * deleted, user lost access, server returned a parseWithFallback fallback
 * with an empty id). We render a low-emphasis placeholder so the user can
 * unpin it from here — otherwise a dead pin stays forever.
 */
import { useMemo } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  View,
} from "react-native";
import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { Ionicons } from "@/components/ui/ionicons";
import type { Issue, PinnedItem, Project } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { IssueRow } from "@/components/issue/issue-row";
import { ProjectRow } from "@/components/project/project-row";
import { pinListOptions } from "@/data/queries/pins";
import { useDeletePin } from "@/data/mutations/pins";
import { issueDetailOptions } from "@/data/queries/issues";
import { projectDetailOptions } from "@/data/queries/projects";
import { issueViewDetailOptions } from "@/data/queries/issue-views";
import { useIssueViewActions } from "@/data/use-issue-view-actions";
import { openPinnedView } from "@/lib/view-pins";
import { useAuthStore } from "@/data/auth-store";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { useT } from "@/lib/i18n";
import { guardedRefresh } from "@/lib/refresh-guard";
import { ListOffline } from "@/components/ui/list-offline";
import { listState } from "@/lib/list-state";

export default function PinsPage() {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const wsSlug = useWorkspaceStore((s) => s.currentWorkspaceSlug);
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const { t } = useT("workspace");

  const query = useQuery(pinListOptions(wsId, userId));
  const { data, error, refetch, isRefetching } = query;

  // Sort by `position` ascending so the order matches web's sidebar
  // (the reorder endpoint writes 1-based positions there too).
  const pins = useMemo(
    () => [...(data ?? [])].sort((a, b) => a.position - b.position),
    [data],
  );

  // Offline before the first load: not "no pins".
  const state = listState(query);
  if (state === "loading") {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator />
      </View>
    );
  }

  if (state === "offline") {
    return (
      <View className="flex-1 bg-background">
        <ListOffline onRetry={() => refetch()} testID="pins-offline" />
      </View>
    );
  }

  if (state === "error") {
    return (
      <View className="flex-1 bg-background px-4 gap-3 pt-4">
        <Text className="text-sm text-destructive">
          {t("pins.errors.load_failed", {
            message: error instanceof Error ? error.message : "unknown",
          })}
        </Text>
        <Button variant="outline" onPress={() => refetch()}>
          <Text>{t("common:actions.retry")}</Text>
        </Button>
      </View>
    );
  }

  if (pins.length === 0) {
    return (
      <View className="flex-1 items-center justify-center bg-background px-6">
        <Text className="text-sm text-muted-foreground text-center">
          {t("pins.empty")}
        </Text>
      </View>
    );
  }

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerClassName="pb-6"
      refreshControl={
        <RefreshControl
          refreshing={isRefetching}
          onRefresh={() => guardedRefresh(refetch)}
        />
      }
      showsVerticalScrollIndicator={false}
    >
      {pins.map((pin, idx) => (
        <View key={pin.id}>
          {idx > 0 ? <View className="h-px bg-border ml-4" /> : null}
          <PinRow pin={pin} wsId={wsId} wsSlug={wsSlug} />
        </View>
      ))}
    </ScrollView>
  );
}

function PinRow({
  pin,
  wsId,
  wsSlug,
}: {
  pin: PinnedItem;
  wsId: string | null;
  wsSlug: string | null;
}) {
  if (pin.item_type === "issue") {
    return (
      <IssuePinRow pin={pin} wsId={wsId} wsSlug={wsSlug} />
    );
  }
  if (pin.item_type === "view") {
    return <ViewPinRow pin={pin} wsId={wsId} wsSlug={wsSlug} />;
  }
  return <ProjectPinRow pin={pin} wsId={wsId} wsSlug={wsSlug} />;
}

function IssuePinRow({
  pin,
  wsId,
  wsSlug,
}: {
  pin: PinnedItem;
  wsId: string | null;
  wsSlug: string | null;
}) {
  const query = useQuery(issueDetailOptions(wsId, pin.item_id));
  const { data } = query;
  // EMPTY_ISSUE_FALLBACK has an empty id — treat as deleted/no-access.
  const issue = data && data.id ? (data as Issue) : null;

  if (pinRowPending(query)) return <SkeletonRow />;
  if (!issue)
    return <MissingPinRow itemType="issue" itemId={pin.item_id} />;

  return (
    <IssueRow
      issue={issue}
      showStatus
      onPress={() => {
        if (wsSlug) router.push(`/${wsSlug}/issue/${issue.id}`);
      }}
    />
  );
}

function ProjectPinRow({
  pin,
  wsId,
  wsSlug,
}: {
  pin: PinnedItem;
  wsId: string | null;
  wsSlug: string | null;
}) {
  const query = useQuery(projectDetailOptions(wsId, pin.item_id));
  const { data } = query;
  const project = data && data.id ? (data as Project) : null;

  if (pinRowPending(query)) return <SkeletonRow />;
  if (!project)
    return <MissingPinRow itemType="project" itemId={pin.item_id} />;

  return (
    <ProjectRow
      project={project}
      onPress={() => {
        if (wsSlug) router.push(`/${wsSlug}/project/${project.id}`);
      }}
    />
  );
}

function ViewPinRow({
  pin,
  wsId,
  wsSlug,
}: {
  pin: PinnedItem;
  wsId: string | null;
  wsSlug: string | null;
}) {
  const { colorScheme } = useColorScheme();
  const { t } = useT("workspace");
  const { applyView } = useIssueViewActions();
  const query = useQuery(issueViewDetailOptions(wsId, pin.item_id));
  const { data, error } = query;

  if (pinRowPending(query)) return <SkeletonRow />;
  if (error && (error as { status?: unknown }).status !== 404) return null;
  if (!data) return <MissingPinRow itemType="view" itemId={pin.item_id} />;

  const view = data;
  return (
    <Pressable
      onPress={() => {
        if (!wsSlug) return;
        void openPinnedView(view, wsSlug, {
          applyView,
          navigate: (href) => router.navigate(href),
        });
      }}
      accessibilityRole="button"
      accessibilityLabel={t("pins.view_a11y", { name: view.name })}
      testID={`pinned-view-${view.id}`}
      className="px-4 py-3 min-h-12 flex-row items-center gap-3 active:bg-secondary"
    >
      <Ionicons
        name="layers-outline"
        size={18}
        color={THEME[colorScheme].mutedForeground}
      />
      <Text className="flex-1 text-sm text-foreground" numberOfLines={2}>
        {view.name}
      </Text>
    </Pressable>
  );
}

/**
 * Loading, or offline before the first read: a placeholder, never the
 * "unavailable — tap to unpin" row for a pin that may be alive.
 */
function pinRowPending(q: Parameters<typeof listState>[0]) {
  const state = listState(q);
  return state === "loading" || state === "offline";
}

function SkeletonRow() {
  return (
    <View className="px-4 py-3 flex-row items-center gap-3">
      <View className="size-5 rounded-xs bg-muted" />
      <View className="flex-1 h-4 rounded-xs bg-muted" />
    </View>
  );
}

/**
 * Renders for pins whose target issue/project was deleted or revoked.
 * Tapping triggers unpin so the user can clean it up; no destination
 * navigation since there's nothing to navigate to. Subtle styling so
 * it doesn't dominate the list of live pins.
 */
function MissingPinRow({
  itemType,
  itemId,
}: {
  itemType: "issue" | "project" | "view";
  itemId: string;
}) {
  const { colorScheme } = useColorScheme();
  const deletePin = useDeletePin();
  const { t } = useT("workspace");
  return (
    <Pressable
      onPress={() => deletePin.mutate({ itemType, itemId })}
      className="px-4 py-3 flex-row items-center gap-3 active:bg-secondary opacity-60"
      accessibilityLabel={
        t(`pins.unavailable_${itemType}`)
      }
    >
      <Ionicons
        name="alert-circle-outline"
        size={18}
        color={THEME[colorScheme].mutedForeground}
      />
      <Text className="flex-1 text-sm text-muted-foreground" numberOfLines={1}>
        {t(`pins.unavailable_${itemType}`)}
      </Text>
    </Pressable>
  );
}
