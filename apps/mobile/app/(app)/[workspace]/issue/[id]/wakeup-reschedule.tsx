/**
 * New time for an `at` wakeup whose time has passed.
 * formSheet route, opened by `useWakeupMenu` when the switch or "Resume"
 * would enable such a rule:
 *
 *   /[workspace]/issue/[id]/wakeup-reschedule?wid=<wakeupId>
 *
 * Presets "In 10 min · In 1 h · Tomorrow 09:00" plus "Pick a time" (system
 * date then time dialog). Sends `enable {revision, at, rearm: true}` like web
 * (`RescheduleWakeup`) and closes only after the server answered.
 */
import { useState } from "react";
import { Platform, Pressable, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { DateTimePickerAndroid, type DateTimePickerEvent } from "@react-native-community/datetimepicker";
import { Text } from "@/components/ui/text";
import { useToggleIssueWakeup } from "@/data/mutations/wakeups";
import { issueWakeupsOptions } from "@/data/queries/wakeups";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useT } from "@/lib/i18n";
import { showToast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import {
  RESCHEDULE_PRESETS,
  isFutureTime,
  rescheduleAt,
  wakeupErrorKind,
} from "@/lib/wakeup-actions";

export default function WakeupRescheduleRoute() {
  const { id: issueId, wid } = useLocalSearchParams<{ id: string; wid: string }>();
  const { t } = useT("issues");
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const { data } = useQuery(issueWakeupsOptions(wsId, issueId));
  const wakeup = data?.find((w) => w.id === wid);
  const toggle = useToggleIssueWakeup(issueId);
  const [error, setError] = useState<string | null>(null);

  const submit = (at: string) => {
    if (!wakeup || toggle.isPending) return;
    if (!isFutureTime(new Date(at))) {
      setError(t("wakeups.reschedule.future"));
      return;
    }
    setError(null);
    toggle.mutate(
      { wakeupId: wakeup.id, enabled: true, revision: wakeup.revision ?? 0, at, rearm: true },
      {
        onSuccess: () => {
          showToast(t("wakeups.toast.enabled"));
          router.back();
        },
        onError: (err) => {
          const kind = wakeupErrorKind(err);
          setError(kind === "failed" ? t("wakeups.toast.toggle_failed") : t(`wakeups.toast.${kind}`));
        },
      },
    );
  };

  const pickTime = () => {
    if (Platform.OS !== "android") return;
    const start = new Date(Date.now() + 60 * 60_000);
    DateTimePickerAndroid.open({
      value: start,
      mode: "date",
      minimumDate: new Date(),
      onChange: (event: DateTimePickerEvent, day?: Date) => {
        if (event.type !== "set" || !day) return;
        DateTimePickerAndroid.open({
          value: start,
          mode: "time",
          onChange: (ev: DateTimePickerEvent, time?: Date) => {
            if (ev.type !== "set" || !time) return;
            const at = new Date(day);
            at.setHours(time.getHours(), time.getMinutes(), 0, 0);
            submit(at.toISOString());
          },
        });
      },
    });
  };

  const agent = wakeup?.agent_name || t("wakeups.agent_subject");
  const options: { key: string; label: string; onPress: () => void }[] = [
    ...RESCHEDULE_PRESETS.map((p) => ({
      key: p,
      label: t(`wakeups.reschedule.${p}`),
      onPress: () => submit(rescheduleAt(p)),
    })),
    { key: "pick", label: t("wakeups.reschedule.pick"), onPress: pickTime },
  ];

  return (
    <View className="flex-1 px-4 pt-4 gap-3">
      <Text accessibilityRole="header" className="text-base font-semibold text-foreground">
        {t("wakeups.reschedule.title")}
      </Text>
      <Text className="text-sm text-muted-foreground">{t("wakeups.reschedule.hint", { agent })}</Text>
      <View className="gap-1">
        {options.map((o) => (
          <Pressable
            key={o.key}
            onPress={o.onPress}
            disabled={!wakeup || toggle.isPending}
            accessibilityRole="button"
            accessibilityState={{ disabled: !wakeup || toggle.isPending }}
            className={cn(
              "min-h-[48px] justify-center rounded-md px-3 active:bg-secondary",
              (!wakeup || toggle.isPending) && "opacity-40",
            )}
            testID={`wakeup-reschedule-${o.key}`}
          >
            <Text className="text-base text-foreground">{o.label}</Text>
          </Pressable>
        ))}
      </View>
      {error ? (
        <Text className="text-sm text-destructive" accessibilityLiveRegion="assertive">
          {error}
        </Text>
      ) : null}
    </View>
  );
}
