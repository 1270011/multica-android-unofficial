/**
 * Edit a saved view. formSheet route, opened from
 * "⋯" in the sheet "Ansichten":
 *
 *   /[workspace]/issue-view-edit?tab=assigned|created|all&id=<view id>
 *
 * Name (1–80 characters, counter), switch "visible for everyone in the
 * workspace" (only for workspace views; `my` views stay private) and
 * "Ansicht löschen" with a confirmation. The view is read fresh; saving
 * sends `expected_revision`, a 409 offers "Neu laden". Only the owner, or
 * a workspace admin for shared views, gets here (`canManageView`).
 */
import { useEffect, useMemo, useState } from "react";
import { Alert, Pressable, ScrollView, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { IssueView } from "@multica/core/api/schemas";
import { Text } from "@/components/ui/text";
import { TextField } from "@/components/ui/text-field";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { showViewConflictDialog } from "@/components/issue/view-conflict-dialog";
import {
  issueViewDetailOptions,
  issueViewKeys,
  issueViewListOptions,
} from "@/data/queries/issue-views";
import { isMyIssuesScope, type MyIssuesScope } from "@/data/queries/issue-keys";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useCanManageView, useIssueViewActions } from "@/data/use-issue-view-actions";
import { viewsForTab } from "@/lib/issue-view-mapping";
import { checkViewName, ISSUE_VIEW_NAME_MAX, viewNameLength } from "@/lib/issue-view-create";
import {
  canChangeVisibility,
  editViewRequest,
  hasViewChanges,
  type ViewUpdateErrorKind,
  viewUpdateErrorKind,
} from "@/lib/issue-view-edit";
import { showToast } from "@/lib/toast";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const MY_SCOPE = { scope_type: "my" } as const;
const WORKSPACE_SCOPE = { scope_type: "workspace" } as const;

export default function IssueViewEditRoute() {
  const { tab: tabParam, id = "" } = useLocalSearchParams<{ tab?: string; id?: string }>();
  const tab: MyIssuesScope = isMyIssuesScope(tabParam) ? tabParam : "assigned";
  const { t } = useT("issues");
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const { editView, deleteView } = useIssueViewActions();
  const canManage = useCanManageView();

  const detail = useQuery({
    ...issueViewDetailOptions(wsId, id),
    staleTime: 0,
    refetchOnMount: "always",
  });
  const view = detail.data ?? null;

  // Cached by the sheet "Ansichten"; only for the duplicate-name check.
  const myList = useQuery(issueViewListOptions(wsId, MY_SCOPE));
  const wsList = useQuery({
    ...issueViewListOptions(wsId, WORKSPACE_SCOPE),
    enabled: !!wsId && tab === "all",
  });
  const existingNames = useMemo(
    () =>
      viewsForTab(tab, myList.data ?? [], tab === "all" ? (wsList.data ?? []) : [])
        .filter((v) => v.id !== id)
        .map((v) => v.name),
    [tab, id, myList.data, wsList.data],
  );

  const [name, setName] = useState("");
  const [shared, setShared] = useState(false);
  const [busy, setBusy] = useState<"save" | "delete" | null>(null);
  const [error, setError] = useState<ViewUpdateErrorKind | null>(null);

  const resetForm = (v: IssueView) => {
    setName(v.name);
    setShared(v.visibility === "workspace");
    setError(null);
  };
  // Fill the form from the server version (first load and "Neu laden").
  const loadedRevision = view ? `${view.id}:${view.revision}` : null;
  useEffect(() => {
    if (view) resetForm(view);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per server revision
  }, [loadedRevision]);

  const gone = () => {
    showToast({ key: "issues:views.gone" });
    void qc.invalidateQueries({ queryKey: issueViewKeys.all(wsId) });
    router.back();
  };
  const forbidden = () => {
    showToast({ key: "issues:views.create.error_forbidden" });
    void qc.invalidateQueries({ queryKey: issueViewKeys.all(wsId) });
    router.back();
  };

  const loadKind = detail.error ? viewUpdateErrorKind(detail.error) : null;
  useEffect(() => {
    if (loadKind === "gone" || (detail.isSuccess && !detail.data)) gone();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per outcome
  }, [loadKind, detail.isSuccess]);

  const check = checkViewName(name, existingNames);
  const nameError = !check.ok ? check.reason : null;
  const patch = view && check.ok ? editViewRequest(view, check.name, shared) : null;
  const allowed = view ? canManage(view) : false;
  const canSave = !!patch && hasViewChanges(patch) && !busy && allowed;

  const handleError = (err: unknown) => {
    const kind = viewUpdateErrorKind(err);
    if (kind === "conflict") {
      showViewConflictDialog(t, "edit", { reload: () => void detail.refetch() });
    } else if (kind === "gone") {
      gone();
    } else if (kind === "forbidden") {
      forbidden();
    } else {
      setError(kind);
    }
  };

  const onSave = async () => {
    if (!view || !patch || !canSave) return;
    setBusy("save");
    setError(null);
    try {
      const saved = await editView(view.id, patch);
      showToast({
        key: "issues:views.edit.saved",
        params: { name: saved?.name ?? patch.name ?? view.name },
      });
      router.back();
    } catch (err) {
      handleError(err);
    } finally {
      setBusy(null);
    }
  };

  const onDelete = () => {
    if (!view || busy) return;
    Alert.alert(
      t("views.edit.delete_title", { name: view.name }),
      view.visibility === "workspace" ? t("views.edit.delete_shared") : undefined,
      [
        { text: t("common:actions.cancel"), style: "cancel" },
        {
          text: t("common:actions.delete"),
          style: "destructive",
          onPress: () => {
            setBusy("delete");
            setError(null);
            deleteView(view.id)
              .then(() => {
                showToast({ key: "issues:views.edit.deleted", params: { name: view.name } });
                router.back();
              })
              .catch(handleError)
              .finally(() => setBusy(null));
          },
        },
      ],
      { cancelable: true },
    );
  };

  if (!view) {
    return (
      <View className="flex-1 gap-3 px-4 pt-4">
        {detail.isError && loadKind !== "gone" ? (
          <>
            <Text className="text-sm text-destructive">{t("views.apply_failed")}</Text>
            <Button variant="outline" onPress={() => void detail.refetch()}>
              <Text>{t("common:actions.retry")}</Text>
            </Button>
          </>
        ) : (
          <View accessibilityLabel={t("views.loading")} className="gap-3">
            <Skeleton className="h-6 w-1/2" />
            <Skeleton className="h-10 w-full" />
          </View>
        )}
      </View>
    );
  }

  const shareable = canChangeVisibility(view);
  const fieldError =
    nameError === "empty" || nameError === "too_long" || nameError === "duplicate"
      ? nameError
      : error === "name"
        ? "too_long"
        : null;
  const sheetError = error && error !== "name" ? error : null;

  return (
    <ScrollView
      className="flex-1"
      contentContainerClassName="px-4 pt-4 pb-6 gap-3"
      keyboardShouldPersistTaps="handled"
    >
      <View className="flex-row flex-wrap items-center justify-between gap-2">
        <Text role="heading" className="shrink text-base font-semibold text-foreground">
          {t("views.edit.title")}
        </Text>
        <Pressable
          onPress={() => void onSave()}
          disabled={!canSave}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityState={{ disabled: !canSave, busy: busy === "save" }}
          testID="issue-view-edit-save"
          className={cn("px-2 py-1 active:opacity-60", !canSave && "opacity-40")}
        >
          <Text className="text-sm text-primary font-semibold">
            {busy === "save" ? t("views.create.saving") : t("views.create.save")}
          </Text>
        </Pressable>
      </View>

      <View className="gap-1">
        <View className="flex-row flex-wrap items-center justify-between gap-2">
          <Text className="text-sm text-foreground">{t("views.create.name_label")}</Text>
          <Text className="text-xs text-muted-foreground" testID="issue-view-edit-counter">
            {t("views.create.counter", {
              count: viewNameLength(name),
              max: ISSUE_VIEW_NAME_MAX,
            })}
          </Text>
        </View>
        <TextField
          value={name}
          onChangeText={(v) => {
            setName(v);
            if (error === "name") setError(null);
          }}
          accessibilityLabel={t("views.create.name_label")}
          returnKeyType="done"
          onSubmitEditing={() => void onSave()}
          invalid={!!fieldError}
          maxLength={ISSUE_VIEW_NAME_MAX * 2}
          editable={!busy}
          testID="issue-view-edit-name"
        />
        {fieldError ? (
          <Text
            className="text-xs text-destructive"
            accessibilityLiveRegion="polite"
            testID="issue-view-edit-name-error"
          >
            {t(`views.create.error_${fieldError}`, { max: ISSUE_VIEW_NAME_MAX })}
          </Text>
        ) : null}
      </View>

      {shareable ? (
        <View className="flex-row items-center justify-between gap-3 min-h-12">
          <Text className="flex-1 text-sm text-foreground">{t("views.create.share")}</Text>
          <Switch
            checked={shared}
            onCheckedChange={setShared}
            disabled={!!busy}
            accessibilityLabel={t("views.create.share")}
            hitSlop={14}
            testID="issue-view-edit-share"
          />
        </View>
      ) : (
        <Text className="text-xs text-muted-foreground" testID="issue-view-edit-private">
          {t(
            view.scope_variant === "involved"
              ? "views.create.private_involved"
              : "views.create.private_hint",
          )}
        </Text>
      )}

      {sheetError ? (
        <Text
          className="text-sm text-destructive"
          accessibilityLiveRegion="polite"
          testID="issue-view-edit-error"
        >
          {t(`views.edit.error_${sheetError === "offline" ? "offline" : "failed"}`)}
        </Text>
      ) : null}

      <View className="mt-2 h-px bg-border" />
      <Pressable
        onPress={onDelete}
        disabled={!!busy}
        accessibilityRole="button"
        accessibilityState={{ disabled: !!busy, busy: busy === "delete" }}
        testID="issue-view-edit-delete"
        className={cn("min-h-12 justify-center active:opacity-60", busy && "opacity-40")}
      >
        <Text className="text-sm text-destructive">
          {busy === "delete" ? t("views.edit.deleting") : t("views.edit.delete")}
        </Text>
      </Pressable>
    </ScrollView>
  );
}
