/**
 * Display texts of the runtime list. Pure functions over the i18n singleton so the list
 * and its unit tests say exactly the same thing; `now` comes from
 * `useVisibleNow` (30-s tick while the screen is visible).
 *
 *   row:     "claude · 2 Agents · 3 warten · zuletzt vor 2 Std."
 *   a11y:    "Runtime claude auf devbox-a, offline seit 2 Stunden, 3 Aufgaben warten."
 *   banner:  "1 Runtime offline mit 3 wartenden Aufgaben"
 */
import type { RuntimeHealth } from "@multica/core/runtimes";
import type { RuntimeMachineGroup, RuntimeRowSummary } from "@/lib/runtime-machines";
import { i18n } from "@/lib/i18n/singleton";

const t = (key: string, opts?: Record<string, unknown>) => i18n.t(`workspace:${key}`, opts);

const MIN = 60_000;

/** "vor 2 Std." from `now` (not `Date.now()`, so the 30-s tick drives it). */
function agoText(iso: string, now: number): string {
  const minutes = Math.floor((now - Date.parse(iso)) / MIN);
  if (minutes < 1) return i18n.t("common:time.just_now");
  if (minutes < 60) return i18n.t("common:time.minutes_ago", { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return i18n.t("common:time.hours_ago", { count: hours });
  return i18n.t("common:time.days_ago", { count: Math.floor(hours / 24) });
}

/** "2 Stunden" for the TalkBack label ("offline seit …"). */
function durationText(iso: string, now: number): string {
  const minutes = Math.max(1, Math.floor((now - Date.parse(iso)) / MIN));
  if (minutes < 60) return t("runtime_list.duration_minutes", { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t("runtime_list.duration_hours", { count: hours });
  return t("runtime_list.duration_days", { count: Math.floor(hours / 24) });
}

const validTime = (iso: string | null | undefined): iso is string =>
  !!iso && !Number.isNaN(Date.parse(iso));

export function runtimeHealthText(health: RuntimeHealth): string {
  return t(`runtime_health.${health}`);
}

/** Colour of the status dot / label, same mapping as the presence dot. */
export function runtimeHealthTone(health: RuntimeHealth): "success" | "warning" | "muted" {
  if (health === "online") return "success";
  if (health === "recently_lost") return "warning";
  return "muted";
}

/** Second line of a runtime row under its machine. */
export function runtimeRowText(row: RuntimeRowSummary, now: number): string {
  const parts = [row.label, t("runtime_list.agents", { count: row.agentCount })];
  if (row.runningCount > 0) parts.push(t("runtime_list.running", { count: row.runningCount }));
  if (row.queuedCount > 0) parts.push(t("runtime_list.queued", { count: row.queuedCount }));
  if (row.health === "recently_lost") parts.push(t("runtime_list.just_lost"));
  else if (row.health !== "online" && validTime(row.runtime.last_seen_at)) {
    parts.push(t("runtime_list.last_seen", { when: agoText(row.runtime.last_seen_at, now) }));
  }
  return parts.join(" · ");
}

/** TalkBack label of a runtime row (UX §3.2). */
export function runtimeRowA11yLabel(
  row: RuntimeRowSummary,
  machineTitle: string,
  now: number,
): string {
  const parts = [t("runtime_list.a11y_runtime", { name: row.label, machine: machineTitle })];
  if (row.health === "online") parts.push(t("runtime_list.a11y_online"));
  else if (row.health === "recently_lost") parts.push(t("runtime_list.a11y_unstable"));
  else if (validTime(row.runtime.last_seen_at)) {
    parts.push(t("runtime_list.a11y_offline_since", { since: durationText(row.runtime.last_seen_at, now) }));
  } else parts.push(t("runtime_list.a11y_offline"));
  parts.push(t("runtime_list.agents", { count: row.agentCount }));
  if (row.runningCount > 0) parts.push(t("runtime_list.running", { count: row.runningCount }));
  if (row.queuedCount > 0) parts.push(t("runtime_list.a11y_queued", { count: row.queuedCount }));
  if (row.isCustomProfile) parts.push(t("runtime_list.badge_custom"));
  return `${parts.join(", ")}.`;
}

/** Machine header label for TalkBack ("devbox-a, Online"). */
export function machineA11yLabel(group: RuntimeMachineGroup): string {
  return `${group.title}, ${runtimeHealthText(group.health)}`;
}

/** Problem banner text: "1 Runtime offline mit 3 wartenden Aufgaben". */
export function runtimeProblemBannerText(summary: { runtimeCount: number; taskCount: number }): string {
  return t("runtime_list.banner", {
    count: summary.runtimeCount,
    tasks: t("runtime_list.banner_tasks", { count: summary.taskCount }),
  });
}
