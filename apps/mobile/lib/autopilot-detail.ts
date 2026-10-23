/**
 * Autopilot detail logic.
 * Pure functions for the detail screen: the triggers as plain text (cron
 * read back, webhook only as its kind), whose runtime the assignee line
 * reflects, the "Runtime offline" warning and "delete, then leave".
 *
 * The run-now toast and the action list are shared with the list (A2,
 * lib/autopilot-list.ts), so row menu and detail never disagree.
 */
import type { MobileAutopilot, MobileAutopilotTrigger } from "@/data/autopilot-schemas";
import type { AgentHangKind } from "@/lib/agent-hang-state";

// --- Cron read-back ---------------------------------------------------------

/**
 * Structured reading of a five-field cron expression, the patterns the web
 * schedule editor produces (packages/views/autopilots/components/
 * schedule-editor/cron-mapping.ts). Anything else is `raw` and shown as is.
 */
export type CronSchedule =
  | { kind: "daily"; time: string }
  | { kind: "weekly"; time: string; days: number[] }
  | { kind: "monthly"; time: string; day: number }
  | { kind: "every_minutes"; interval: number }
  | { kind: "every_hours"; interval: number; minute: number }
  | { kind: "raw"; expr: string };

const pad2 = (n: number) => String(n).padStart(2, "0");

function int(field: string, min: number, max: number): number | null {
  if (!/^\d{1,2}$/.test(field)) return null;
  const n = Number(field);
  return n >= min && n <= max ? n : null;
}

function step(field: string, max: number): number | null {
  const m = /^\*\/(\d{1,2})$/.exec(field);
  if (!m) return field === "*" ? 1 : null;
  const n = Number(m[1]);
  return n >= 1 && n <= max ? n : null;
}

/** Day-of-week list ("1-5", "1,3,5", "0,6"; 7 = Sunday) → sorted 0–6, or null. */
export function parseWeekdays(field: string): number[] | null {
  const days = new Set<number>();
  for (const part of field.split(",")) {
    const range = /^(\d)-(\d)$/.exec(part);
    if (range) {
      const lo = Number(range[1]);
      const hi = Number(range[2]);
      if (lo > hi || hi > 7) return null;
      for (let d = lo; d <= hi; d++) days.add(d % 7);
      continue;
    }
    const d = int(part, 0, 7);
    if (d === null) return null;
    days.add(d % 7);
  }
  return days.size ? [...days].sort((a, b) => a - b) : null;
}

export function parseCronSchedule(expr: string | null | undefined): CronSchedule | null {
  const raw = (expr ?? "").trim();
  if (!raw) return null;
  const fields = raw.split(/\s+/);
  if (fields.length !== 5) return { kind: "raw", expr: raw };
  const [min, hour, dom, month, dow] = fields as [string, string, string, string, string];
  if (month !== "*") return { kind: "raw", expr: raw };

  const m = int(min, 0, 59);
  const h = int(hour, 0, 23);
  if (m !== null && h !== null) {
    const time = `${pad2(h)}:${pad2(m)}`;
    if (dom === "*" && dow === "*") return { kind: "daily", time };
    if (dom === "*") {
      const days = parseWeekdays(dow);
      if (days) return days.length === 7 ? { kind: "daily", time } : { kind: "weekly", time, days };
    }
    const day = int(dom, 1, 31);
    if (day !== null && dow === "*") return { kind: "monthly", time, day };
    return { kind: "raw", expr: raw };
  }
  if (dom !== "*" || dow !== "*") return { kind: "raw", expr: raw };
  if (m !== null && hour.startsWith("*")) {
    const interval = step(hour, 23);
    if (interval !== null) return { kind: "every_hours", interval, minute: m };
  }
  if (hour === "*" && min.startsWith("*")) {
    const interval = step(min, 59);
    if (interval !== null) return { kind: "every_minutes", interval };
  }
  return { kind: "raw", expr: raw };
}

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** Collapse three or more consecutive days into a range, like the web. */
function formatDays(days: number[], t: Translate): string {
  const name = (d: number) => t(`autopilot.detail.weekday.${d}`);
  const parts: string[] = [];
  let i = 0;
  while (i < days.length) {
    let j = i;
    while (j + 1 < days.length && days[j + 1] === days[j]! + 1) j++;
    if (j - i >= 2) parts.push(t("autopilot.detail.days_range", { from: name(days[i]!), to: name(days[j]!) }));
    else for (let k = i; k <= j; k++) parts.push(name(days[k]!));
    i = j + 1;
  }
  return parts.join(", ");
}

/** "täglich 02:00", "Mo–Fr 09:00", "alle 2 Std (:15)"; raw cron otherwise. */
export function describeCron(schedule: CronSchedule, t: Translate): string {
  switch (schedule.kind) {
    case "daily":
      return t("autopilot.detail.cron_daily", { time: schedule.time });
    case "weekly":
      return t("autopilot.detail.cron_weekly", { days: formatDays(schedule.days, t), time: schedule.time });
    case "monthly":
      return t("autopilot.detail.cron_monthly", { day: schedule.day, time: schedule.time });
    case "every_minutes":
      return t("autopilot.detail.cron_every_minutes", { count: schedule.interval });
    case "every_hours":
      return t("autopilot.detail.cron_every_hours", {
        count: schedule.interval,
        minute: pad2(schedule.minute),
      });
    case "raw":
      return t("autopilot.detail.cron_raw", { expr: schedule.expr });
  }
}

// --- Trigger lines (read-only) ---------------------------------------------

export interface TriggerLine {
  id: string;
  kind: MobileAutopilotTrigger["kind"];
  /** Translated kind, or the raw wire value for an unknown kind. */
  kindLabel: string;
  /** Schedule only: plain-language cron. Never a webhook URL. */
  schedule: string | null;
  timezone: string | null;
  nextRunAt: string | null;
  label: string | null;
  enabled: boolean;
}

/**
 * Read-only trigger lines. A webhook only shows its kind and on/off: the
 * schema already drops token, path and URL, and nothing here would
 * carry them anyway (§2.3 "Webhook-URL nicht anzeigen").
 */
export function triggerLines(triggers: readonly MobileAutopilotTrigger[], t: Translate): TriggerLine[] {
  return triggers.map((tr) => {
    const parsed = tr.kind === "schedule" ? parseCronSchedule(tr.cron_expression) : null;
    return {
      id: tr.id,
      kind: tr.kind,
      kindLabel: tr.kind === "unknown" ? tr.raw_kind || "?" : t(`autopilot.trigger.${tr.kind}`),
      schedule: parsed ? describeCron(parsed, t) : null,
      timezone: tr.kind === "schedule" ? tr.timezone || null : null,
      nextRunAt: tr.kind === "schedule" && tr.enabled ? tr.next_run_at || null : null,
      label: tr.label?.trim() || null,
      enabled: tr.enabled,
    };
  });
}

// --- Assignee runtime -------------------------------------------------------

/**
 * Agent whose runtime the assignee line reflects: the agent itself, or the
 * squad's leader (§2.3 "des Agenten bzw. des Squad-Leiters"). Null when it
 * is not knowable (unknown assignee type, squad not visible).
 */
export function presenceAgentId(
  a: Pick<MobileAutopilot, "assignee_type" | "assignee_id">,
  squads: readonly { id: string; leader_id: string }[] | undefined,
): string | null {
  if (a.assignee_type === "agent") return a.assignee_id || null;
  if (a.assignee_type === "squad") return squads?.find((s) => s.id === a.assignee_id)?.leader_id || null;
  return null;
}

/**
 * Whether scheduled runs would be skipped right now: the runtime is
 * offline (stuck or idle) or the agent has none. Shows the amber hint
 * "Runtime offline – geplante Läufe werden übersprungen".
 */
export function runtimeBlocksRuns(kind: AgentHangKind | null): boolean {
  return kind === "stuck_offline" || kind === "unavailable" || kind === "no_runtime";
}

/** "40 Min" / "3 Std" / "2 Tg" for the hang hint ("offline seit …"). */
export function formatOfflineFor(ms: number, t: Translate): string {
  const minutes = Math.max(1, Math.floor(ms / 60_000));
  if (minutes < 60) return t("autopilot.detail.duration_min", { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return t("autopilot.detail.duration_h", { count: hours });
  return t("autopilot.detail.duration_d", { count: Math.floor(hours / 24) });
}

// --- Delete, then leave -----------------------------------------------------

/**
 * Delete waits for the server and only then leaves the detail (§2.3 "nach
 * Erfolg zurück zur Liste"). On failure the detail stays and `onFailed`
 * explains why. Resolves to whether it navigated.
 */
export async function deleteThenLeave(
  remove: () => Promise<unknown>,
  leave: () => void,
  onFailed: () => void,
): Promise<boolean> {
  try {
    await remove();
  } catch {
    onFailed();
    return false;
  }
  leave();
  return true;
}
