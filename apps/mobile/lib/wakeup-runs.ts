/**
 * Runs of one issue wakeup. Pure functions for the
 * row text of `GET /api/issues/{id}/wakeups/{wid}/runs`: status (unknown
 * values as raw text, never a crash), what triggered the run, whether it
 * commented or ended silently with a check-in note, start time and duration.
 *
 * The server returns the latest 10 runs, newest first, without paging
 * (server/pkg/db/queries/wakeup.sql `ListWakeupRuns`). Read-only.
 */
import type { WakeupRun } from "@/data/wakeup-schemas";
import { formatRunDuration, type RunTone } from "@/lib/autopilot-runs";
import { i18n } from "@/lib/i18n/singleton";
import {
  formatWakeupTime,
  isKnownWakeupEvent,
  wakeupEventText,
  wakeupRunStateText,
} from "@/lib/wakeup-text";

/** Server cap of the runs list; a full list says "latest 10". */
export const WAKEUP_RUNS_LIMIT = 10;

const t = (key: string, options?: Record<string, unknown>) =>
  String(i18n.t(`issues:wakeups.run_list.${key}`, options));

const STATUS_TONE: Record<string, RunTone> = {
  queued: "running",
  deferred: "warning",
  dispatched: "running",
  running: "running",
  waiting_local_directory: "warning",
  completed: "success",
  failed: "danger",
  cancelled: "muted",
};

export function wakeupRunTone(status: string): RunTone {
  return STATUS_TONE[status] ?? "muted";
}

/** "Lauf erfolgreich" …; an unknown status shows its raw text, an empty one
 *  "Unbekannter Status". */
export function wakeupRunStatusLabel(status: string): string {
  return wakeupRunStateText(status) ?? t("status_unknown");
}

/** Platform facts that are not workspace events (service/issue_wakeup_*.go). */
const PLATFORM_TRIGGERS: Record<string, string> = {
  "time.due": "time_due",
  "wakeup.manual": "manual",
  "wakeup.timeout": "timeout",
  "condition.met": "condition_met",
};

/** One trigger in words; an unknown event type is shown as it is. */
export function wakeupRunTriggerText(event: string, agent?: string | null): string {
  const key = PLATFORM_TRIGGERS[event];
  if (key) return t(`trigger.${key}`);
  return isKnownWakeupEvent(event) ? wakeupEventText(event, agent) : event;
}

/** "Auslöser: …" or `null` when the run carries no facts. */
export function wakeupRunTriggersText(run: Pick<WakeupRun, "triggers">, agent?: string | null): string | null {
  const parts = [...new Set(run.triggers.filter(Boolean))].map((e) => wakeupRunTriggerText(e, agent));
  return parts.length > 0 ? t("triggers", { list: parts.join(", ") }) : null;
}

/** "Hat kommentiert" or "Still beendet: <note>"; `null` = neither. A
 *  check-in note wins: such a run ended without a comment by design. */
export function wakeupRunOutcomeText(run: Pick<WakeupRun, "commented" | "checkin_note">): string | null {
  const note = run.checkin_note.trim();
  if (note) return t("checkin", { note });
  if (run.commented) return t("commented");
  return null;
}

export function wakeupRunOutcome(run: Pick<WakeupRun, "commented" | "checkin_note">): "checkin" | "commented" | "none" {
  if (run.checkin_note.trim()) return "checkin";
  return run.commented ? "commented" : "none";
}

/** Duration from start to end; null while it runs or when a time is broken. */
export function wakeupRunDurationMs(run: Pick<WakeupRun, "started_at" | "completed_at">): number | null {
  if (!run.started_at || !run.completed_at) return null;
  const start = Date.parse(run.started_at);
  const end = Date.parse(run.completed_at);
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return null;
  return end - start;
}

export interface WakeupRunRow {
  status: string;
  tone: RunTone;
  /** Start time (or queue time while not started) · duration. */
  meta: string;
  triggers: string | null;
  outcome: string | null;
  a11y: string;
}

/** Everything one row shows, plus its TalkBack label. */
export function wakeupRunRow(run: WakeupRun, agent?: string | null, now = new Date()): WakeupRunRow {
  const status = wakeupRunStatusLabel(run.status);
  const when = run.started_at || run.created_at;
  const duration = wakeupRunDurationMs(run);
  const meta = [
    when ? formatWakeupTime(when, now) : null,
    duration !== null ? formatRunDuration(duration, (k, o) => String(i18n.t(`workspace:${k}`, o))) : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const triggers = wakeupRunTriggersText(run, agent);
  const outcome = wakeupRunOutcomeText(run);
  const a11y = [status, meta, triggers, outcome].filter(Boolean).join(", ");
  return { status, tone: wakeupRunTone(run.status), meta, triggers, outcome, a11y };
}
