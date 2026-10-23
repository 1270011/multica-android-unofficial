/**
 * View bar of My Issues: "Ansicht: <name> ▾" opens the sheet "Ansichten"; the
 * list/board toggle stays on the right. Wraps at 200 % font size. When the
 * applied view filters something the app cannot show, a note follows.
 *
 * When the filters on screen differ from the applied view, the name
 * gets "· geändert" and two text buttons follow: "Speichern" (only for who
 * may manage the view) and "Verwerfen". Offline "Speichern" is disabled
 * and "Offline – zum Speichern verbinden" stands next to it.
 */
import { Pressable, View } from "react-native";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { Ionicons } from "@/components/ui/ionicons";
import type { ActiveIssueView } from "@/data/stores/active-issue-view-store";
import { viewSaveButton } from "@/lib/issue-view-edit";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export function IssueViewBar({
  active,
  onOpen,
  right,
  modified = false,
  canSave = false,
  saving = false,
  offline = false,
  onSave,
  onDiscard,
}: {
  active: ActiveIssueView | null;
  onOpen: () => void;
  right: React.ReactNode;
  modified?: boolean;
  canSave?: boolean;
  saving?: boolean;
  /** No network: "Speichern" is disabled with a hint. */
  offline?: boolean;
  onSave?: () => void;
  onDiscard?: () => void;
}) {
  const { t } = useT("issues");
  const { colorScheme } = useColorScheme();
  const name = active?.name ?? t("views.default");
  const changed = !!active && modified;
  const button = viewSaveButton({ canSave, saving, online: !offline });
  const locked = button === "saving" || button === "offline";
  const label = changed ? t("views.edit.bar_modified", { name }) : t("views.bar", { name });
  return (
    <View className="px-4 pb-2 gap-2">
      <View className="flex-row flex-wrap items-center justify-between gap-2">
        <Button
          variant="ghost"
          size="sm"
          onPress={onOpen}
          // 44 dp + 2 dp hit-slop = 48 dp touch target.
          hitSlop={2}
          className="h-11 flex-row items-center gap-1 px-2 max-w-full shrink"
          accessibilityLabel={t("views.bar_a11y", {
            name: changed ? t("views.edit.modified_a11y", { name }) : name,
          })}
          testID="issue-view-bar"
        >
          <Text numberOfLines={1} className="shrink text-sm text-foreground">
            {label}
          </Text>
          <Ionicons
            name="chevron-down"
            size={14}
            color={THEME[colorScheme].mutedForeground}
          />
        </Button>
        {right}
      </View>
      {changed ? (
        <View className="flex-row flex-wrap items-center justify-end gap-x-4 gap-y-2">
          {button === "offline" ? (
            <Text
              className="shrink text-xs text-muted-foreground"
              testID="issue-view-save-offline"
            >
              {t("views.edit.save_offline")}
            </Text>
          ) : null}
          {button !== "hidden" ? (
            <Pressable
              onPress={onSave}
              disabled={locked}
              // At least 44×44 dp + 2 dp hit-slop (was ~32×34).
              hitSlop={2}
              accessibilityRole="button"
              accessibilityState={{ disabled: locked, busy: button === "saving" }}
              accessibilityHint={button === "offline" ? t("views.edit.save_offline") : undefined}
              testID="issue-view-save"
              className={cn(
                "min-h-11 min-w-11 items-center justify-center active:opacity-60",
                locked && "opacity-40",
              )}
            >
              <Text className="text-sm font-semibold text-primary">
                {button === "saving" ? t("views.create.saving") : t("views.edit.save")}
              </Text>
            </Pressable>
          ) : null}
          <Pressable
            onPress={onDiscard}
            disabled={saving}
            hitSlop={2}
            accessibilityRole="button"
            testID="issue-view-discard"
            className="min-h-11 min-w-11 items-center justify-center active:opacity-60"
          >
            <Text className="text-sm text-muted-foreground">{t("views.edit.discard")}</Text>
          </Pressable>
        </View>
      ) : null}
      {active?.hiddenFilters ? (
        <View className="flex-row items-start gap-2 rounded-md bg-secondary px-3 py-2">
          <Ionicons
            name="information-circle-outline"
            size={16}
            color={THEME[colorScheme].mutedForeground}
          />
          <Text className="flex-1 text-xs text-muted-foreground" testID="issue-view-hidden-filters">
            {t("views.hidden_filters")}
          </Text>
        </View>
      ) : null}
    </View>
  );
}
