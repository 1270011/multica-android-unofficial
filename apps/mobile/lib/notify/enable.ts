/**
 * Switching operator notifications on and off (docs/UX.md §8.8
 * P4b). Order on "on": POST_NOTIFICATIONS (Android 13+) → settings +
 * session hand-over → start the service → battery-optimisation exemption as
 * a separate, explained second step. Never called at app start.
 */
import { Alert, PermissionsAndroid, Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
import { api } from "@/data/api";
import { i18n } from "@/lib/i18n";
import { rbNotify, type NotifySettings } from "./native";
import { clearNotifySession, handOverSession } from "./session";

const BATTERY_ASKED_KEY = "rb_notify_battery_asked";

export type PermissionOutcome = "granted" | "denied" | "blocked";

export async function requestNotificationPermission(): Promise<PermissionOutcome> {
  if (Platform.OS !== "android" || Number(Platform.Version) < 33) return "granted";
  const perm = PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS;
  if (await PermissionsAndroid.check(perm)) return "granted";
  const res = await PermissionsAndroid.request(perm);
  if (res === PermissionsAndroid.RESULTS.GRANTED) return "granted";
  return res === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN ? "blocked" : "denied";
}

/** Returns the permission outcome; settings only change when granted. */
export async function enablePush(): Promise<PermissionOutcome> {
  const outcome = await requestNotificationPermission();
  if (outcome === "blocked") {
    // Second refusal: Android no longer shows the dialog (UX §8.8.4).
    rbNotify.openNotificationSettings(null);
    return outcome;
  }
  if (outcome !== "granted") return outcome;
  const settings = rbNotify.getSettings();
  rbNotify.setSettings({ ...settings, enabled: true });
  handOverSession(api.getToken());
  rbNotify.start();
  // Second step only once on its own; afterwards only from the settings row.
  if (!(await SecureStore.getItemAsync(BATTERY_ASKED_KEY))) {
    await SecureStore.setItemAsync(BATTERY_ASKED_KEY, "1");
    askBatteryExemption();
  }
  return outcome;
}

export function disablePush(): void {
  const settings = rbNotify.getSettings();
  rbNotify.setSettings({ ...settings, enabled: false });
  rbNotify.stop();
  // No background connection → no reason to keep the session copy.
  clearNotifySession();
}

export function applySettings(next: NotifySettings): void {
  rbNotify.setSettings(next);
  // Re-sync sockets (workspace list / switches) while we are in the foreground.
  if (next.enabled) rbNotify.start();
}

/** Second step (UX §8.8, TECHNIK §1.7): explained before the system dialog. */
export function askBatteryExemption(): void {
  const status = rbNotify.getStatus();
  if (!status || status.batteryExempt) return;
  const t = i18n.t.bind(i18n);
  Alert.alert(t("settings:push.battery_title"), t("settings:push.battery_body"), [
    { text: t("common:actions.cancel"), style: "cancel" },
    {
      text: t("settings:push.battery_allow"),
      onPress: () => {
        rbNotify.requestIgnoreBatteryOptimizations();
      },
    },
  ]);
}
