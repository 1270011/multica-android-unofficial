/**
 * Drop-in for the parts of `expo-haptics` the app uses, loaded on first call
 * (lib/lazy-module.ts). The functions are async, so a failed late load
 * rejects like a native error instead of throwing in the caller's handler.
 * Use as `import * as Haptics from "@/lib/haptics"`.
 * The enum values mirror expo-haptics' string enums.
 */
import type * as ExpoHaptics from "expo-haptics";
import { lazyModule } from "./lazy-module";

const load = lazyModule(
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  () => require("expo-haptics") as typeof ExpoHaptics,
);

export const ImpactFeedbackStyle = {
  Light: "light",
  Medium: "medium",
  Heavy: "heavy",
  Soft: "soft",
  Rigid: "rigid",
} as const;
type ImpactStyle = (typeof ImpactFeedbackStyle)[keyof typeof ImpactFeedbackStyle];

export const NotificationFeedbackType = {
  Success: "success",
  Warning: "warning",
  Error: "error",
} as const;
type NotificationType = (typeof NotificationFeedbackType)[keyof typeof NotificationFeedbackType];

export async function impactAsync(style: ImpactStyle = ImpactFeedbackStyle.Medium): Promise<void> {
  return load().impactAsync(style as ExpoHaptics.ImpactFeedbackStyle);
}

export async function notificationAsync(
  type: NotificationType = NotificationFeedbackType.Success,
): Promise<void> {
  return load().notificationAsync(type as ExpoHaptics.NotificationFeedbackType);
}

export async function selectionAsync(): Promise<void> {
  return load().selectionAsync();
}
