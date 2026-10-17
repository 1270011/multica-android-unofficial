/**
 * How long an action toast ("Undo") stays (review #19): 6 s are too short
 * to reach the button with TalkBack. Android's "time to take action"
 * setting (getRecommendedTimeoutMillis) always applies, also without a
 * screen reader (switch access, motor impairments; the CI
 * emulator sets it so Maestro reaches "Undo" under load). With a screen
 * reader on, at least 20 s.
 */
import { AccessibilityInfo } from "react-native";
import { ACTION_TOAST_DURATION_MS } from "@/lib/toast";

export const SCREEN_READER_MIN_MS = 20_000;

export async function actionToastDuration(): Promise<number> {
  try {
    const recommended = await AccessibilityInfo.getRecommendedTimeoutMillis(ACTION_TOAST_DURATION_MS);
    const duration = Math.max(recommended, ACTION_TOAST_DURATION_MS);
    if (!(await AccessibilityInfo.isScreenReaderEnabled())) return duration;
    return Math.max(duration, SCREEN_READER_MIN_MS);
  } catch {
    return ACTION_TOAST_DURATION_MS;
  }
}
