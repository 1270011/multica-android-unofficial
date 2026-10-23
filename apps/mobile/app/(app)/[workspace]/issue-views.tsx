/**
 * Sheet "Ansichten" for My Issues: "Standard" plus the saved views of the
 * current tab, own and shared, in the order and visibility of the web view
 * preferences. Tapping a row applies it and closes the sheet.
 *
 *   /[workspace]/issue-views?tab=assigned|created|all
 *
 * Views send no WS events, so both lists reload every time the sheet opens
 * (staleTime 0). The last row saves the current filters as a new view
 * (D8b, issue-view-create). "⋯" on a row opens one menu: "Anpinnen"/"Lösen"
 * for everyone (D8d; 409 = already pinned, silent; pinned rows carry 📌)
 * and, only for who may manage the view (owner; for shared views also
 * workspace admins), "Bearbeiten …", which opens the edit sheet (D8c,
 * issue-view-edit: rename, share, delete).
 */
import { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import type { IssueView } from "@multica/core/api/schemas";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Ionicons } from "@/components/ui/ionicons";
import {
  issueViewListOptions,
  issueViewPreferenceOptions,
} from "@/data/queries/issue-views";
import { isMyIssuesScope, type MyIssuesScope } from "@/data/queries/issue-keys";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useActiveIssueView } from "@/data/stores/active-issue-view-store";
import { useAuthStore } from "@/data/auth-store";
import { pinListOptions } from "@/data/queries/pins";
import { useCreatePin, useDeletePin } from "@/data/mutations/pins";
import { showActionSheet } from "@/lib/action-sheet";
import { showToast } from "@/lib/toast";
import { isAlreadyPinned, isViewPinned, viewRowActions } from "@/lib/view-pins";
import { useCanManageView, useIssueViewActions } from "@/data/use-issue-view-actions";
import { orderViews, viewsForTab } from "@/lib/issue-view-mapping";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { ListOffline } from "@/components/ui/list-offline";
import { combinedListState } from "@/lib/list-state";

const MY_SCOPE = { scope_type: "my" } as const;
const WORKSPACE_SCOPE = { scope_type: "workspace" } as const;

export default function IssueViewsRoute() {
  const { tab: tabParam, workspace } = useLocalSearchParams<{
    tab?: string;
    workspace?: string;
  }>();
  const tab: MyIssuesScope = isMyIssuesScope(tabParam) ? tabParam : "assigned";
  const { t } = useT("issues");
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const active = useActiveIssueView(wsId);
  const { applyView, exitView } = useIssueViewActions();
  const canManage = useCanManageView();
  const [applying, setApplying] = useState<string | null>(null);
  const { colorScheme } = useColorScheme();
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const { data: pins } = useQuery(pinListOptions(wsId, userId));
  const createPin = useCreatePin();
  const deletePin = useDeletePin();

  const fresh = { staleTime: 0, refetchOnMount: "always" as const };
  const myList = useQuery({ ...issueViewListOptions(wsId, MY_SCOPE), ...fresh });
  const wsList = useQuery({
    ...issueViewListOptions(wsId, WORKSPACE_SCOPE),
    ...fresh,
    enabled: !!wsId && tab === "all",
  });
  const myPref = useQuery({ ...issueViewPreferenceOptions(wsId, MY_SCOPE), ...fresh });
  const wsPref = useQuery({
    ...issueViewPreferenceOptions(wsId, WORKSPACE_SCOPE),
    ...fresh,
    enabled: !!wsId && tab === "all",
  });

  const lists = tab === "all" ? [myList, wsList] : [myList];
  // Offline before the first read: not "no views".
  const state = combinedListState(lists);
  const views = useMemo(
    () =>
      orderViews(
        viewsForTab(tab, myList.data ?? [], tab === "all" ? (wsList.data ?? []) : []),
        tab === "all" ? wsPref.data : null,
        myPref.data,
      ),
    [tab, myList.data, wsList.data, myPref.data, wsPref.data],
  );

  // The applied view vanished from a fresh list (deleted / no longer
  // shared): same as a 404 on apply.
  const settled = lists.every((q) => q.isSuccess && !q.isFetching);
  useEffect(() => {
    if (!active || !settled) return;
    const all = [...(myList.data ?? []), ...(wsList.data ?? [])];
    // Outside "All" the applied view is always a `my` view (a manual tab
    // change drops it), so the loaded lists suffice.
    if (!all.some((v) => v.id === active.id)) void applyView(active.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once per settled list
  }, [settled]);

  const pick = async (view: IssueView | null) => {
    if (!view) {
      exitView();
      router.back();
      return;
    }
    setApplying(view.id);
    const outcome = await applyView(view.id);
    setApplying(null);
    if (outcome === "apply") router.back();
  };

  const openMenu = (view: IssueView) => {
    const pinned = isViewPinned(pins, view.id);
    const actions = viewRowActions(pinned, canManage(view) && !!workspace);
    const labels = { pin: "views.pin", unpin: "views.unpin", edit: "views.edit_action" } as const;
    showActionSheet(
      {
        options: [t("common:actions.cancel"), ...actions.map((a) => t(labels[a]))],
        cancelButtonIndex: 0,
        title: view.name,
      },
      (i) => {
        const action = actions[i - 1];
        if (!action) return;
        if (action === "edit") {
          if (workspace) {
            router.replace({
              pathname: "/[workspace]/issue-view-edit",
              params: { workspace, tab, id: view.id },
            });
          }
          return;
        }
        const onError = (error: unknown) => {
          if (!isAlreadyPinned(error)) showToast({ key: "issues:views.pin_failed" });
        };
        if (action === "unpin") deletePin.mutate({ itemType: "view", itemId: view.id }, { onError });
        else createPin.mutate({ item_type: "view", item_id: view.id }, { onError });
      },
    );
  };

  return (
    <View className="flex-1">
      <View className="px-4 pt-4 pb-3">
        <Text role="heading" className="text-base font-semibold text-foreground">
          {t("views.sheet_title", { tab: t(`tabs.${tab}`) })}
        </Text>
      </View>
      <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
        <ViewRow
          name={t("views.default")}
          selected={!active}
          onPress={() => void pick(null)}
          testID="issue-view-default"
        />
        {state === "loading" ? (
          <View className="gap-3 px-4 py-3" accessibilityLabel={t("views.loading")}>
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-6 w-3/4" />
            ))}
          </View>
        ) : state === "offline" ? (
          <ListOffline
            onRetry={() => lists.forEach((q) => void q.refetch())}
            testID="issue-views-offline"
          />
        ) : state === "error" ? (
          <View className="gap-3 px-4 py-3">
            <Text className="text-sm text-destructive">{t("views.load_failed")}</Text>
            <Button
              variant="outline"
              onPress={() => lists.forEach((q) => void q.refetch())}
            >
              <Text>{t("common:actions.retry")}</Text>
            </Button>
          </View>
        ) : views.length === 0 ? (
          <Text className="px-4 py-3 text-sm text-muted-foreground">{t("views.empty")}</Text>
        ) : (
          views.map((view) => (
            <ViewRow
              key={view.id}
              name={view.name}
              shared={view.visibility === "workspace"}
              pinned={isViewPinned(pins, view.id)}
              selected={active?.id === view.id}
              busy={applying === view.id}
              onPress={() => void pick(view)}
              onMore={() => openMenu(view)}
              testID={`issue-view-item-${view.id}`}
            />
          ))
        )}
        <View className="mx-4 my-1 h-px bg-border" />
        <Pressable
          onPress={() => {
            if (!workspace) return;
            router.replace({
              pathname: "/[workspace]/issue-view-create",
              params: { workspace, tab },
            });
          }}
          testID="issue-view-create"
          accessibilityRole="button"
          className="flex-row items-center gap-3 px-4 py-2.5 min-h-12 active:bg-secondary"
        >
          <View className="w-4">
            <Ionicons name="add" size={16} color={THEME[colorScheme].foreground} />
          </View>
          <Text className="flex-1 text-sm text-foreground">{t("views.create.add")}</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

function ViewRow({
  name,
  shared = false,
  pinned = false,
  selected,
  busy = false,
  onPress,
  onMore,
  testID,
}: {
  name: string;
  shared?: boolean;
  pinned?: boolean;
  selected: boolean;
  busy?: boolean;
  onPress: () => void;
  /** "⋯": the row menu (pin/unpin, edit for managers); absent = no button. */
  onMore?: () => void;
  testID?: string;
}) {
  const { t } = useT("issues");
  const { colorScheme } = useColorScheme();
  const parts = [name, shared ? t("views.shared") : null, pinned ? t("views.pinned") : null]
    .filter(Boolean)
    .join(", ");
  return (
    <View className="flex-row items-center">
      <Pressable
        onPress={onPress}
        disabled={busy}
        testID={testID}
        accessibilityRole="radio"
        accessibilityState={{ checked: selected, busy }}
        accessibilityLabel={parts}
        className={cn(
          "flex-1 flex-row items-center gap-3 px-4 py-2.5 min-h-12 active:bg-secondary",
          onMore && "pr-1",
          selected && "bg-secondary/60",
        )}
      >
        <View className="w-4">
          {selected ? (
            <Ionicons name="checkmark" size={16} color={THEME[colorScheme].foreground} />
          ) : null}
        </View>
        <Text numberOfLines={2} className="flex-1 text-sm text-foreground">
          {pinned ? "📌 " : ""}
          {name}
        </Text>
        {shared ? (
          <View className="rounded-full border border-border px-2 py-0.5">
            <Text className="text-xs text-muted-foreground">{t("views.shared")}</Text>
          </View>
        ) : null}
      </Pressable>
      {onMore ? (
        <Pressable
          onPress={onMore}
          hitSlop={4}
          accessibilityRole="button"
          accessibilityLabel={t("views.more_a11y", { name })}
          testID={testID ? `${testID}-more` : undefined}
          className={cn(
            "min-h-12 min-w-12 items-center justify-center active:bg-secondary",
            selected && "bg-secondary/60",
          )}
        >
          <Ionicons
            name="ellipsis-horizontal"
            size={18}
            color={THEME[colorScheme].mutedForeground}
          />
        </Pressable>
      ) : null}
    </View>
  );
}
