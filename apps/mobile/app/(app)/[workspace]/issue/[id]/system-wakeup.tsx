/**
 * System wakeup sheet "Unteraufgaben fertig". formSheet route, opened from the row in the "Wakeups" section:
 *
 *   /[workspace]/issue/[id]/system-wakeup?rule=child_done
 *
 * Switch (sends only `enabled`) and instruction (sends only `instruction`;
 * empty = the default applies), both via `PUT …/system-wakeups/{rule}`.
 * After a 403 the sheet is display-only. The workspace rules (B5.5) have no
 * screen in the app yet, so the link shows a hint instead.
 */
import { useEffect, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { Text } from "@/components/ui/text";
import { Switch } from "@/components/ui/switch";
import { TextField } from "@/components/ui/text-field";
import { useUpdateIssueSystemWakeup } from "@/data/mutations/wakeups";
import { issueSystemWakeupsOptions } from "@/data/queries/wakeups";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useT } from "@/lib/i18n";
import { showToast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { wakeupErrorKind } from "@/lib/wakeup-actions";
import {
  SYSTEM_RULE_CHILD_DONE,
  checkSystemInstruction,
  systemWakeupBlockedHint,
  systemWakeupPutBody,
  systemWakeupTargetText,
  systemWakeupTitle,
} from "@/lib/system-wakeup";
import { wakeupPausedText } from "@/lib/wakeup-text";

export default function SystemWakeupRoute() {
  const { id: issueId, rule: ruleParam } = useLocalSearchParams<{ id: string; rule?: string }>();
  const ruleKey = ruleParam || SYSTEM_RULE_CHILD_DONE;
  const { t } = useT("issues");
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const query = useQuery(issueSystemWakeupsOptions(wsId, issueId));
  const update = useUpdateIssueSystemWakeup(issueId);
  const rule = query.data?.find((r) => r.rule === ruleKey) ?? null;

  const [value, setValue] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [rulesHint, setRulesHint] = useState(false);
  // Seed once; refetches must not replace the draft.
  useEffect(() => {
    if (rule && value === null) setValue(rule.instruction);
  }, [rule, value]);

  const draft = value ?? "";
  const check = checkSystemInstruction(draft, rule?.instruction ?? "");
  const tooLong = !check.ok && check.reason === "too_long";
  const canSave = check.ok && !!rule && !forbidden && !update.isPending;

  const send = async (patch: { enabled?: boolean; instruction?: string }, done: string) => {
    if (!rule) return false;
    try {
      await update.mutateAsync({ rule: rule.rule, ...systemWakeupPutBody(patch) });
      showToast(done);
      return true;
    } catch (err) {
      if (wakeupErrorKind(err) === "forbidden") setForbidden(true);
      showToast(t(wakeupErrorKind(err) === "forbidden" ? "wakeups.system.forbidden" : "wakeups.system.save_failed"));
      return false;
    }
  };

  const onSave = async () => {
    if (!check.ok || !canSave) return;
    if (await send({ instruction: check.instruction }, t("wakeups.system.saved"))) setValue(check.instruction);
  };

  if (!rule) {
    return (
      <View className="flex-1 px-4 pt-4">
        <Text className="text-sm text-muted-foreground" accessibilityLiveRegion="polite">
          {query.isPending ? t("wakeups.loading") : t("wakeups.error")}
        </Text>
      </View>
    );
  }

  const paused = rule.paused_reason
    ? wakeupPausedText({ paused_reason: rule.paused_reason, max_fires: null, fire_count: 0 })
    : null;
  const blocked = systemWakeupBlockedHint(rule.blocked);
  const readOnly = forbidden;

  return (
    <ScrollView
      className="flex-1"
      contentContainerClassName="px-4 pt-4 pb-8 gap-3"
      keyboardShouldPersistTaps="handled"
      testID="system-wakeup-sheet"
    >
      <View className="flex-row items-center justify-between gap-2">
        <View className="flex-1 gap-0.5">
          <Text accessibilityRole="header" className="text-base font-semibold text-foreground">
            {t("wakeups.system.sheet_title")}
          </Text>
          <Text className="text-sm text-foreground">{systemWakeupTitle(rule)}</Text>
        </View>
        {readOnly ? null : (
          <Pressable
            onPress={onSave}
            disabled={!canSave}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityState={{ disabled: !canSave, busy: update.isPending }}
            className={cn("min-h-[48px] px-2 justify-center active:opacity-60", !canSave && "opacity-40")}
            testID="system-wakeup-save"
          >
            <Text className="text-sm text-primary font-semibold">{t("wakeups.system.save")}</Text>
          </Pressable>
        )}
      </View>

      {paused ? (
        <Text className="rounded-md bg-secondary px-2 py-1.5 text-sm text-foreground" testID="system-wakeup-paused">
          {paused}
        </Text>
      ) : null}
      {blocked ? (
        <Text
          className="rounded-md border border-border px-2 py-1.5 text-sm text-foreground"
          accessibilityLiveRegion="polite"
          testID="system-wakeup-blocked"
        >
          {blocked}
        </Text>
      ) : null}
      {readOnly ? (
        <Text className="text-sm text-muted-foreground" testID="system-wakeup-no-rights">
          {t("wakeups.system.forbidden")}
        </Text>
      ) : null}

      <View className="gap-1">
        <Text className="text-xs text-muted-foreground">{t("wakeups.system.target_title")}</Text>
        <Text className="text-sm text-foreground">{systemWakeupTargetText(rule)}</Text>
      </View>
      {rule.total > 0 ? (
        <View className="gap-1">
          <Text className="text-xs text-muted-foreground">{t("wakeups.system.progress_title")}</Text>
          <Text className="text-sm text-foreground">
            {t("wakeups.system.progress", { done: rule.total - rule.remaining, total: rule.total })}
            {rule.waiting.length > 0 ? ` · ${t("wakeups.system.waiting_on", { ids: rule.waiting.join(", ") })}` : ""}
          </Text>
        </View>
      ) : null}

      <View className="flex-row items-center gap-2 min-h-[48px]">
        <Text className="flex-1 text-sm text-foreground">{t("wakeups.system.enable")}</Text>
        <Switch
          checked={rule.enabled}
          disabled={readOnly || update.isPending}
          onCheckedChange={(on) =>
            void send({ enabled: on }, t(on ? "wakeups.system.toggled_on" : "wakeups.system.toggled_off"))
          }
          accessibilityLabel={t("wakeups.system.toggle_a11y")}
          hitSlop={14}
          testID="system-wakeup-switch"
        />
      </View>

      <View className="gap-1">
        <Text className="text-sm font-medium text-foreground">{t("wakeups.system.instruction")}</Text>
        {readOnly ? (
          <Text className="text-sm text-foreground" selectable>
            {rule.instruction || rule.default_instruction}
          </Text>
        ) : (
          <TextField
            value={draft}
            onChangeText={setValue}
            accessibilityLabel={t("wakeups.system.instruction")}
            placeholder={t("wakeups.system.instruction_placeholder")}
            multiline
            style={{ textAlignVertical: "top", minHeight: 120, paddingVertical: 8 }}
            invalid={tooLong}
            editable={!update.isPending}
            testID="system-wakeup-instruction"
          />
        )}
        {tooLong ? (
          <Text className="text-xs text-destructive" accessibilityLiveRegion="polite">
            {t("wakeups.system.instruction_too_long")}
          </Text>
        ) : null}
        {!draft.trim() && rule.default_instruction ? (
          <View className="gap-0.5" testID="system-wakeup-default">
            <Text className="text-xs text-muted-foreground">{t("wakeups.system.instruction_default")}</Text>
            <Text className="text-xs text-muted-foreground" numberOfLines={6}>
              {rule.default_instruction}
            </Text>
          </View>
        ) : null}
      </View>

      <View className="gap-1 border-t border-border pt-3">
        <Text className="text-xs text-muted-foreground">
          {t(rule.workspace_default ? "wakeups.system.default_on" : "wakeups.system.default_off")}
          {rule.customized ? ` ${t("wakeups.system.customized")}` : ""}
        </Text>
        <Pressable
          onPress={() => setRulesHint(true)}
          accessibilityRole="link"
          className="min-h-[48px] justify-center active:opacity-60"
          testID="system-wakeup-rules-link"
        >
          <Text className="text-sm text-primary">{t("wakeups.system.rules_link")}</Text>
        </Pressable>
        {rulesHint ? (
          <Text className="text-xs text-muted-foreground" accessibilityLiveRegion="polite" testID="system-wakeup-rules-hint">
            {t("wakeups.system.rules_pending")}
          </Text>
        ) : null}
      </View>
    </ScrollView>
  );
}
