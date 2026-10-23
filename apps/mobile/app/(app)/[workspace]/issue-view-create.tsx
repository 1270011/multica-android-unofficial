/**
 * Save the current My Issues filters as a view. formSheet
 * route, opened from the sheet "Ansichten":
 *
 *   /[workspace]/issue-view-create?tab=assigned|created|all
 *
 * Name (1–80 characters, counter), switch "visible for everyone in the
 * workspace" (hidden in `my` scopes, which are always private), and a short
 * summary of what gets saved. The due filter is app-only and not saved.
 * After saving, the new view is the active one and the sheet closes.
 * Errors (lib/issue-view-create.ts): name and limit stay in the sheet,
 * 403 is a toast and reloads the view list.
 */
import { useMemo, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Text } from "@/components/ui/text";
import { TextField } from "@/components/ui/text-field";
import { Switch } from "@/components/ui/switch";
import { issueViewKeys, issueViewListOptions } from "@/data/queries/issue-views";
import { isMyIssuesScope, type MyIssuesScope } from "@/data/queries/issue-keys";
import { useWorkspaceStore } from "@/data/workspace-store";
import { currentState, useIssueViewActions } from "@/data/use-issue-view-actions";
import { issueListFilterCount } from "@/lib/issue-list-filters";
import { viewsForTab } from "@/lib/issue-view-mapping";
import {
  canShareView,
  checkViewName,
  ISSUE_VIEW_NAME_MAX,
  type ViewCreateErrorKind,
  viewCreateErrorKind,
  viewNameLength,
} from "@/lib/issue-view-create";
import { showToast } from "@/lib/toast";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const MY_SCOPE = { scope_type: "my" } as const;
const WORKSPACE_SCOPE = { scope_type: "workspace" } as const;

export default function IssueViewCreateRoute() {
  const { tab: tabParam } = useLocalSearchParams<{ tab?: string }>();
  const tab: MyIssuesScope = isMyIssuesScope(tabParam) ? tabParam : "assigned";
  const { t } = useT("issues");
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const { createView } = useIssueViewActions();

  // The state that gets saved, read once when the sheet opens.
  const [state] = useState(() => (wsId ? currentState(wsId) : null));
  const shareable = state ? canShareView(state) : false;

  // Cached by the sheet "Ansichten"; only for the duplicate-name check.
  const myList = useQuery(issueViewListOptions(wsId, MY_SCOPE));
  const wsList = useQuery({
    ...issueViewListOptions(wsId, WORKSPACE_SCOPE),
    enabled: !!wsId && tab === "all",
  });
  const existingNames = useMemo(
    () =>
      viewsForTab(tab, myList.data ?? [], tab === "all" ? (wsList.data ?? []) : []).map(
        (v) => v.name,
      ),
    [tab, myList.data, wsList.data],
  );

  const [name, setName] = useState("");
  const [shared, setShared] = useState(false);
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<ViewCreateErrorKind | null>(null);

  const check = checkViewName(name, existingNames);
  const nameError = !check.ok && (touched || check.reason !== "empty") ? check.reason : null;
  const canSave = check.ok && !saving && !!state;

  const onSave = async () => {
    setTouched(true);
    if (!check.ok || !state || saving) return;
    setSaving(true);
    setError(null);
    try {
      const view = await createView(check.name, shared);
      if (view) {
        showToast({ key: "issues:views.create.created", params: { name: view.name } });
        router.back();
        return;
      }
      setError("failed");
    } catch (err) {
      const kind = viewCreateErrorKind(err);
      if (kind === "forbidden") {
        showToast({ key: "issues:views.create.error_forbidden" });
        void qc.invalidateQueries({ queryKey: issueViewKeys.all(wsId) });
        router.back();
        return;
      }
      if (kind === "duplicate") void qc.invalidateQueries({ queryKey: issueViewKeys.all(wsId) });
      setError(kind);
    } finally {
      setSaving(false);
    }
  };

  const fieldError =
    nameError ?? (error === "name" ? "too_long" : error === "duplicate" ? "duplicate" : null);
  const sheetError = error && error !== "name" && error !== "duplicate" ? error : null;
  const filterCount = state ? issueListFilterCount({ ...state.filters, due: [] }) : 0;
  const sortField = state ? t(`sort.field_${state.sort.field}`) : "";

  return (
    <ScrollView
      className="flex-1"
      contentContainerClassName="px-4 pt-4 pb-6 gap-3"
      keyboardShouldPersistTaps="handled"
    >
      <View className="flex-row flex-wrap items-center justify-between gap-2">
        <Text role="heading" className="shrink text-base font-semibold text-foreground">
          {t("views.create.title")}
        </Text>
        <Pressable
          onPress={() => void onSave()}
          disabled={!canSave}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityState={{ disabled: !canSave, busy: saving }}
          testID="issue-view-create-save"
          className={cn("px-2 py-1 active:opacity-60", !canSave && "opacity-40")}
        >
          <Text className="text-sm text-primary font-semibold">
            {saving ? t("views.create.saving") : t("views.create.save")}
          </Text>
        </Pressable>
      </View>

      <View className="gap-1">
        <View className="flex-row flex-wrap items-center justify-between gap-2">
          <Text className="text-sm text-foreground">{t("views.create.name_label")}</Text>
          <Text className="text-xs text-muted-foreground" testID="issue-view-create-counter">
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
            if (error === "name" || error === "duplicate") setError(null);
          }}
          onBlur={() => setTouched(true)}
          placeholder={t("views.create.name_placeholder")}
          accessibilityLabel={t("views.create.name_label")}
          autoFocus
          returnKeyType="done"
          onSubmitEditing={() => void onSave()}
          invalid={!!fieldError}
          // maxLength counts UTF-16 units; 2× leaves room for emoji, the
          // character check enforces the server limit.
          maxLength={ISSUE_VIEW_NAME_MAX * 2}
          testID="issue-view-create-name"
        />
        {fieldError ? (
          <Text
            className="text-xs text-destructive"
            accessibilityLiveRegion="polite"
            testID="issue-view-create-name-error"
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
            disabled={saving}
            accessibilityLabel={t("views.create.share")}
            hitSlop={14}
            testID="issue-view-create-share"
          />
        </View>
      ) : (
        <Text className="text-xs text-muted-foreground" testID="issue-view-create-private">
          {t(tab === "all" ? "views.create.private_involved" : "views.create.private_hint")}
        </Text>
      )}

      {state ? (
        <View className="gap-1 rounded-md bg-secondary px-3 py-2">
          <Text className="text-xs text-muted-foreground" testID="issue-view-create-summary">
            {t("views.create.summary", {
              tab: t(`tabs.${state.tab}`),
              filters:
                filterCount === 0
                  ? t("views.create.no_filters")
                  : t("views.create.filter_count", { count: filterCount }),
              sort: sortField,
            })}
          </Text>
          {state.filters.due.length > 0 ? (
            <Text className="text-xs text-muted-foreground" testID="issue-view-create-due">
              {t("views.create.due_not_saved")}
            </Text>
          ) : null}
        </View>
      ) : null}

      {sheetError ? (
        <Text
          className="text-sm text-destructive"
          accessibilityLiveRegion="polite"
          testID="issue-view-create-error"
        >
          {t(`views.create.error_${sheetError}`)}
        </Text>
      ) : null}
    </ScrollView>
  );
}
