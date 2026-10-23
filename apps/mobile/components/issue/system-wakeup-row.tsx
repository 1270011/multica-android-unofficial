/**
 * System wakeup row "Unteraufgaben fertig" in the issue's "Wakeups" section
 * (spec §1.2 "System-Wakeup-Zeile"). Text and switch;
 * a tap opens the sheet issue/[id]/system-wakeup for the instruction.
 * The switch sends only `enabled` (lib/system-wakeup.ts `systemWakeupPutBody`).
 * After a 403 the row is display-only.
 */
import { useState } from "react";
import { router } from "expo-router";
import { Pressable, View } from "react-native";
import { Text } from "@/components/ui/text";
import { Switch } from "@/components/ui/switch";
import { Ionicons } from "@/components/ui/ionicons";
import { useUpdateIssueSystemWakeup } from "@/data/mutations/wakeups";
import type { MobileSystemWakeup } from "@/data/wakeup-schemas";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { useT } from "@/lib/i18n";
import { showToast } from "@/lib/toast";
import { wakeupErrorKind } from "@/lib/wakeup-actions";
import {
  systemWakeupA11yLabel,
  systemWakeupExtraHint,
  systemWakeupPutBody,
  systemWakeupSummary,
  systemWakeupTitle,
} from "@/lib/system-wakeup";

export function SystemWakeupRow({ issueId, rule }: { issueId: string; rule: MobileSystemWakeup }) {
  const { t } = useT("issues");
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  const wsSlug = useWorkspaceStore((s) => s.currentWorkspaceSlug);
  const update = useUpdateIssueSystemWakeup(issueId);
  const [forbidden, setForbidden] = useState(false);
  const hint = systemWakeupExtraHint(rule);

  const toggle = (enabled: boolean) => {
    update.mutate(
      { rule: rule.rule, ...systemWakeupPutBody({ enabled }) },
      {
        onSuccess: () => showToast(t(enabled ? "wakeups.system.toggled_on" : "wakeups.system.toggled_off")),
        onError: (err) => {
          if (wakeupErrorKind(err) === "forbidden") {
            setForbidden(true);
            showToast(t("wakeups.system.forbidden"));
          } else {
            showToast(t("wakeups.system.save_failed"));
          }
        },
      },
    );
  };

  return (
    <View className="px-4 py-2 border-t border-border/60" testID="issue-system-wakeup-row">
      <View className="flex-row items-start gap-1">
        <Pressable
          accessible
          accessibilityRole="button"
          accessibilityLabel={systemWakeupA11yLabel(rule)}
          accessibilityHint={t("wakeups.system.open_a11y")}
          onPress={() => {
            if (!wsSlug) return;
            router.push({
              pathname: "/[workspace]/issue/[id]/system-wakeup",
              params: { workspace: wsSlug, id: issueId, rule: rule.rule },
            });
          }}
          className="flex-1 gap-1 py-1 active:opacity-60"
          testID="issue-system-wakeup-body"
        >
          <View className="flex-row items-start gap-2">
            <Ionicons name="git-network-outline" size={16} color={theme.foreground} style={{ marginTop: 2 }} />
            <Text className="flex-1 text-sm text-foreground font-medium">{systemWakeupTitle(rule)}</Text>
            <View className="rounded bg-secondary px-1.5">
              <Text className="text-xs text-muted-foreground">{t("wakeups.system.badge")}</Text>
            </View>
          </View>
          <Text
            className={rule.paused_reason ? "ml-6 text-xs text-foreground" : "ml-6 text-xs text-muted-foreground"}
            testID="issue-system-wakeup-summary"
          >
            {systemWakeupSummary(rule)}
          </Text>
          {hint ? (
            <Text className="ml-6 text-xs text-muted-foreground" testID="issue-system-wakeup-hint">
              {hint}
            </Text>
          ) : null}
          {forbidden ? (
            <Text className="ml-6 text-xs text-muted-foreground" testID="issue-system-wakeup-no-rights">
              {t("wakeups.system.forbidden")}
            </Text>
          ) : null}
        </Pressable>
        {forbidden ? null : (
          <View className="min-h-[48px] min-w-[48px] items-center justify-center">
            <Switch
              checked={rule.enabled}
              disabled={update.isPending}
              onCheckedChange={toggle}
              accessibilityLabel={t("wakeups.system.toggle_a11y")}
              hitSlop={14}
              testID="issue-system-wakeup-switch"
            />
          </View>
        )}
      </View>
    </View>
  );
}
