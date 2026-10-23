/**
 * Timing marks for on-device measurements. Off in every shipped
 * bundle: only a perf APK built with `EXPO_PUBLIC_PERF_MARKS=1`
 * (`e2e/perf/build-perf-apk.sh`) writes `[perf] <name>` lines to logcat,
 * where logcat's own timestamp lines them up with the deep link's `START`.
 * The gate is spelled out so Metro folds it (see lib/logger.ts).
 */
const ON = process.env.EXPO_PUBLIC_PERF_MARKS === "1";
/** For marks that need extra work (timers, measuring) only when measured. */
export const PERF_MARKS_ON = ON;

/** A function builds the text only in a perf APK (marks on the render path). */
export function perfMark(name: string | (() => string)): void {
  if (!ON) return;
  // eslint-disable-next-line no-console -- logcat is the measuring channel here
  console.warn(`[perf] ${typeof name === "function" ? name() : name}`);
}
