/**
 * "Push auf diesem Gerät": device
 * settings of the operator notifications, shown above the server inbox
 * groups. Everything here is stored natively (modules/rb-notify) and applies
 * to all workspaces of the account; the server groups stay per workspace.
 *
 * Status (permission, connection, battery exemption) is polled from the
 * native side while the screen is focused, so a permission revoked in
 * Android shows up on the next visit without a nagging dialog (§8.8.8).
 */
import { useCallback, useState } from "react";
import { Platform, Pressable, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { DateTimePickerAndroid } from "@react-native-community/datetimepicker";
import type { NotificationGroupKey, NotificationPreferences } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Ionicons } from "@/components/ui/ionicons";
import { workspaceListOptions } from "@/data/queries/workspaces";
import { inboxListOptions } from "@/data/queries/inbox";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useUpdateNotificationPreferences } from "@/data/mutations/notification-preferences";
import {
  NOTIFY_CATEGORIES,
  notifyAvailable,
  rbNotify,
  type NotifyCategory,
  type NotifySettings,
  type NotifyStatus,
} from "@/lib/notify/native";
import { applySettings, askBatteryExemption, disablePush, enablePush } from "@/lib/notify/enable";
import {
  DEFAULT_QUIET,
  dateFromHhmm,
  hhmm,
  mutedServerGroup,
  setCategory,
  setQuietHours,
  setWorkspaceEnabled,
} from "@/lib/notify/push-logic";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { useT } from "@/lib/i18n";

const STATUS_POLL_MS = 2000;

export function PushSettingsSection({
  serverPrefs,
}: {
  serverPrefs: NotificationPreferences | undefined;
}) {
  const { t } = useT("settings");
  const [settings, setSettings] = useState<NotifySettings>(() => rbNotify.getSettings());
  const [status, setStatus] = useState<NotifyStatus | null>(() => rbNotify.getStatus());
  const [showWorkspaces, setShowWorkspaces] = useState(false);
  const { data: workspaces } = useQuery(workspaceListOptions());
  const updateServer = useUpdateNotificationPreferences();
  const wsId = useWorkspaceStore((st) => st.currentWorkspaceId);
  const wsSlug = useWorkspaceStore((st) => st.currentWorkspaceSlug);
  const { data: inbox } = useQuery(inboxListOptions(wsId));

  useFocusEffect(
    useCallback(() => {
      setSettings(rbNotify.getSettings());
      setStatus(rbNotify.getStatus());
      const timer = setInterval(() => setStatus(rbNotify.getStatus()), STATUS_POLL_MS);
      return () => clearInterval(timer);
    }, []),
  );

  const update = useCallback((next: NotifySettings) => {
    applySettings(next);
    setSettings(next);
  }, []);

  if (!notifyAvailable || Platform.OS !== "android") return null;

  const permissionBlocked = !!status && (!status.permissionGranted || !status.notificationsEnabled);
  const enabled = settings.enabled && !permissionBlocked;
  const connectionOn = enabled && settings.connectionEnabled;
  const quietOn = settings.quietStart !== null && settings.quietEnd !== null;
  const wsCount = workspaces?.length ?? 0;
  const wsOn = (workspaces ?? []).filter((w) => !settings.disabledWorkspaces.includes(w.slug)).length;

  const onMaster = async (on: boolean) => {
    if (on) {
      await enablePush();
    } else {
      disablePush();
    }
    setSettings(rbNotify.getSettings());
    setStatus(rbNotify.getStatus());
  };

  const unmute = (group: NotificationGroupKey) => {
    const next: NotificationPreferences = { ...(serverPrefs ?? {}) };
    delete next[group];
    updateServer.mutate(next);
  };

  const pickTime = (which: "start" | "end") => {
    const current = which === "start" ? settings.quietStart : settings.quietEnd;
    DateTimePickerAndroid.open({
      value: dateFromHhmm(current ?? (which === "start" ? DEFAULT_QUIET.start : DEFAULT_QUIET.end)),
      mode: "time",
      is24Hour: true,
      onChange: (event, selected) => {
        if (event.type !== "set" || !selected) return;
        const start = which === "start" ? hhmm(selected) : (settings.quietStart ?? DEFAULT_QUIET.start);
        const end = which === "end" ? hhmm(selected) : (settings.quietEnd ?? DEFAULT_QUIET.end);
        update(setQuietHours(settings, { start, end }));
      },
    });
  };

  const connectionLabel = !connectionOn
    ? t("push.connection_off_hint")
    : status?.running && (status.connected ?? 0) > 0
      ? (status.connected ?? 0) > 1
        ? t("push.status_connected_many", { count: status.connected })
        : t("push.status_connected")
      : t("push.status_reconnecting");

  return (
    <View className="gap-2">
      <View className="px-1">
        <Text className="text-xs uppercase tracking-wider text-muted-foreground">
          {t("push.title")}
        </Text>
      </View>
      <View className="rounded-md border border-border bg-card overflow-hidden">
        <Row
          label={t("push.master")}
          description={t("push.master_description")}
          checked={enabled}
          onChange={(on) => void onMaster(on)}
        />
        {permissionBlocked ? (
          <Hint
            text={t("push.blocked_hint")}
            action={t("push.open_settings")}
            onAction={() => rbNotify.openNotificationSettings(null)}
          />
        ) : null}

        {!permissionBlocked ? (
          <>
            <Separator />
            {NOTIFY_CATEGORIES.map((category) => {
              const muted = mutedServerGroup(category, serverPrefs);
              return (
                <View key={category}>
                  <Row
                    label={t(`push.category_${category}`)}
                    checked={!settings.disabledCategories.includes(category)}
                    disabled={!connectionOn}
                    onChange={(on) => update(setCategory(settings, category as NotifyCategory, on))}
                  />
                  {muted ? (
                    <Hint
                      text={t("push.server_group_muted", { group: t(`groups.${muted}`) })}
                      action={t("push.turn_on")}
                      onAction={() => unmute(muted)}
                    />
                  ) : null}
                </View>
              );
            })}
            <Separator />
            <Row
              label={t("push.quiet_hours")}
              checked={quietOn}
              disabled={!connectionOn}
              onChange={(on) => update(setQuietHours(settings, on ? { ...DEFAULT_QUIET } : null))}
            />
            {quietOn ? (
              <View className="px-4 pb-3 gap-1">
                <View className="flex-row gap-3">
                  <TimeButton
                    label={t("push.quiet_from", { time: settings.quietStart })}
                    onPress={() => pickTime("start")}
                    disabled={!connectionOn}
                  />
                  <TimeButton
                    label={t("push.quiet_to", { time: settings.quietEnd })}
                    onPress={() => pickTime("end")}
                    disabled={!connectionOn}
                  />
                </View>
                <Text className="text-xs text-muted-foreground">{t("push.quiet_hint")}</Text>
              </View>
            ) : null}
            <Separator />
            <Row
              label={t("push.connection")}
              description={connectionLabel}
              checked={connectionOn}
              disabled={!enabled}
              onChange={(on) => update({ ...settings, connectionEnabled: on })}
            />
            {wsCount > 1 ? (
              <>
                <NavRow
                  label={t("push.workspaces", { on: wsOn, total: wsCount })}
                  onPress={() => setShowWorkspaces((v) => !v)}
                  expanded={showWorkspaces}
                />
                {showWorkspaces ? (
                  <View className="pl-4">
                    <Text className="px-4 pt-1 text-xs text-muted-foreground">
                      {t("push.workspaces_hint")}
                    </Text>
                    {(workspaces ?? []).map((w) => (
                      <Row
                        key={w.id}
                        label={w.name}
                        checked={!settings.disabledWorkspaces.includes(w.slug)}
                        disabled={!connectionOn}
                        onChange={(on) => update(setWorkspaceEnabled(settings, w.slug, on))}
                      />
                    ))}
                  </View>
                ) : null}
              </>
            ) : null}
            <NavRow
              label={t("push.battery")}
              description={
                status?.batteryExempt ? t("push.battery_unrestricted") : t("push.battery_restricted")
              }
              onPress={() =>
                status?.batteryExempt ? rbNotify.openNotificationSettings(null) : askBatteryExemption()
              }
            />
          </>
        ) : null}
        <Separator />
        <NavRow
          label={t("push.sound_vibration")}
          onPress={() => rbNotify.openNotificationSettings(null)}
        />
        {/* Debug builds only (test trigger): posts a sample
            notification for the newest inbox issue through the real native
            path, tap included. Gate spelled out so Metro folds it away. */}
        {process.env.EXPO_PUBLIC_DEBUG_TOKEN_LOGIN === "1" && enabled ? (
          <>
            <Separator />
            <NavRow
              label={t("push.debug_test")}
              onPress={() => {
                const item = inbox?.find((i) => i.issue_id);
                if (wsSlug && item?.issue_id) rbNotify.debugNotify(wsSlug, item.issue_id, item.title);
              }}
            />
          </>
        ) : null}
      </View>
    </View>
  );
}

function Row({
  label,
  description,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  description?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <View className="flex-row items-center px-4 py-3 gap-3 min-h-[56px]">
      <View className="flex-1">
        <Text className={disabled ? "text-base text-muted-foreground" : "text-base font-medium text-foreground"}>
          {label}
        </Text>
        {description ? (
          <Text className="text-xs text-muted-foreground mt-0.5">{description}</Text>
        ) : null}
      </View>
      <Switch
        checked={checked}
        disabled={disabled}
        onCheckedChange={onChange}
        accessibilityLabel={label}
      />
    </View>
  );
}

function NavRow({
  label,
  description,
  onPress,
  expanded,
}: {
  label: string;
  description?: string;
  onPress: () => void;
  expanded?: boolean;
}) {
  const { colorScheme } = useColorScheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={description ? `${label}, ${description}` : label}
      accessibilityState={expanded === undefined ? undefined : { expanded }}
      className="flex-row items-center px-4 py-3 gap-3 min-h-[56px] active:opacity-70"
    >
      <View className="flex-1">
        <Text className="text-base font-medium text-foreground">{label}</Text>
        {description ? (
          <Text className="text-xs text-muted-foreground mt-0.5">{description}</Text>
        ) : null}
      </View>
      <Ionicons
        name={expanded ? "chevron-down" : "chevron-forward"}
        size={16}
        color={THEME[colorScheme].mutedForeground}
      />
    </Pressable>
  );
}

function Hint({ text, action, onAction }: { text: string; action: string; onAction: () => void }) {
  return (
    <View className="flex-row items-start gap-2 px-4 pb-3">
      <Text className="flex-1 text-xs text-muted-foreground">⚠ {text}</Text>
      <Pressable onPress={onAction} accessibilityRole="button" className="min-h-[32px] justify-center">
        <Text className="text-xs font-medium text-primary">{action}</Text>
      </Pressable>
    </View>
  );
}

function TimeButton({
  label,
  onPress,
  disabled,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      className="min-h-[48px] justify-center rounded-md border border-border px-3 active:opacity-70"
    >
      <Text className="text-sm text-foreground">{label}</Text>
    </Pressable>
  );
}
