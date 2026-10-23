/**
 * Plain-language text for issue wakeups.
 *
 * Mobile port of the read-only parts of web's
 * packages/views/issues/components/wakeup-presentation.ts: the condition in
 * plain words, who set the rule up, its deadline and the pause reason. Pure
 * functions over the app i18n singleton (like lib/time-ago.ts), so every
 * `kind` — including "unknown" from a newer server — is unit-testable
 * without rendering.
 */
import type { WakeupCondition } from "@multica/core/types";
import type {
  MobileIssueWakeup,
  MobileIssueWakeupSummaryRow,
  WakeupKind,
} from "@/data/wakeup-schemas";
import { i18n } from "@/lib/i18n/singleton";

/** Lookups the condition text needs from workspace catalogs. All optional:
 *  a missing name falls back to a neutral word, never to a raw id. */
export interface WakeupNames {
  status?: (key: string) => string;
  actor?: (type: string, id: string) => string | undefined;
  label?: (id: string) => string | undefined;
  property?: (id: string) => string | undefined;
}

/** The fields the row text reads; summary rows carry a subset. */
type WakeupLike = Pick<
  MobileIssueWakeup,
  | "kind"
  | "event_types"
  | "filter_agent_name"
  | "filter_actor_type"
  | "filter_actor_name"
  | "filter_task_id"
  | "interval_seconds"
  | "cron_expression"
  | "timezone"
  | "next_fire_at"
  | "condition"
>;

const t = (key: string, options?: Record<string, unknown>) =>
  String(i18n.t(`issues:wakeups.${key}`, options));

function locale(): string {
  return i18n.resolvedLanguage ?? i18n.language ?? "en";
}

export type WakeupIcon = "time" | "recurring" | "event" | "unknown";

/** ⏰ one-off time, 🔁 recurring, ⚡ event or condition (spec §1.2 line 1). */
export function wakeupIcon(w: Pick<WakeupLike, "kind" | "condition">): WakeupIcon {
  if (w.condition) return "event";
  switch (w.kind) {
    case "at":
      return "time";
    case "every":
    case "cron":
      return "recurring";
    case "event":
      return "event";
    default:
      return "unknown";
  }
}

/** Ionicons name per icon kind. */
export const WAKEUP_ICON_NAME: Record<WakeupIcon, "alarm-outline" | "repeat" | "flash-outline" | "help-circle-outline"> = {
  time: "alarm-outline",
  recurring: "repeat",
  event: "flash-outline",
  unknown: "help-circle-outline",
};

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** "Today 09:00", "Tomorrow 09:00", otherwise "18 Oct, 08:00" (year only
 *  when it differs). An unparseable value is shown as-is. */
export function formatWakeupTime(value: string, now = new Date()): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  const clock = new Intl.DateTimeFormat(locale(), { hour: "2-digit", minute: "2-digit" }).format(date);
  if (sameDay(date, now)) return t("time.today", { time: clock });
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  if (sameDay(date, tomorrow)) return t("time.tomorrow", { time: clock });
  return new Intl.DateTimeFormat(locale(), {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: "numeric" as const }),
  }).format(date);
}

/** Grace around the due time: within a minute either side reads "now". */
const NOW_WINDOW_MS = 60_000;

/** True once a due time lies more than a minute in the past:
 *  the rule is still on but did not fire, so "now" would be misleading. */
export function isOverdue(value: string, now = Date.now()): boolean {
  const ms = Date.parse(value) - now;
  return Number.isFinite(ms) && ms < -NOW_WINDOW_MS;
}

/** "in 10 min" / "in 3 h" / "in 2 days"; "now" within a minute of the
 *  time; "overdue" once it is more than a minute past. */
export function formatRelativeIn(value: string, now = Date.now()): string | null {
  const ms = Date.parse(value) - now;
  if (!Number.isFinite(ms)) return null;
  if (ms < -NOW_WINDOW_MS) return t("time.overdue");
  if (ms <= NOW_WINDOW_MS) return t("time.now");
  const minutes = Math.ceil(ms / 60_000);
  if (minutes < 60) return t("time.in_minutes", { count: minutes });
  const hours = Math.round(minutes / 60);
  if (hours < 24) return t("time.in_hours", { count: hours });
  return t("time.in_days", { count: Math.round(hours / 24) });
}

const EVENT_KEYS: Record<string, string> = {
  "task.queued": "run_queued",
  "task.dispatched": "run_dispatched",
  "task.started": "run_started",
  "task.deferred": "run_deferred",
  "task.waiting_local_directory": "run_waiting_local_directory",
  "task.completed": "run_completed",
  "task.failed": "run_failed",
  "task.cancelled": "run_cancelled",
  "issue.updated": "issue_updated",
  "issue.status_changed": "status_changed",
  "issue.assignee_changed": "assignee_changed",
  "issue.parent_changed": "parent_changed",
  "issue.project_changed": "project_changed",
  "issue.labels_changed": "labels_changed",
  "issue.properties_changed": "properties_changed",
  "issue.metadata_changed": "metadata_changed",
  "comment.created": "comment_created",
  "comment.updated": "comment_updated",
  "comment.deleted": "comment_deleted",
  "comment.resolved": "comment_resolved",
  "comment.unresolved": "comment_unresolved",
  "reaction.added": "reaction_added",
  "reaction.removed": "reaction_removed",
  "attachment.attached": "attachment_attached",
  "attachment.detached": "attachment_detached",
};

/** True for an event type this app has words for. */
export function isKnownWakeupEvent(event: string): boolean {
  return event in EVENT_KEYS;
}

/** One event type in words; an unknown type names the raw event. */
export function wakeupEventText(event: string, agent?: string | null): string {
  const key = EVENT_KEYS[event];
  if (!key) return t("unknown_event", { event });
  return t(`events.${key}`, { agent: agent || t("agent_subject") });
}

/** A platform-checked condition in words (web `wakeups.cond.*`). */
export function wakeupConditionText(c: WakeupCondition, names: WakeupNames = {}): string {
  switch (c.type) {
    case "issue_field":
      switch (c.field) {
        case "status":
          return t("cond.status", { status: names.status?.(c.value) ?? c.value });
        case "assignee":
          return t("cond.assignee", {
            name: names.actor?.(c.assignee_type, c.assignee_id) || t("cond.someone"),
          });
        case "label":
          return t("cond.label", { label: names.label?.(c.label_id) ?? t("cond.unknown_label") });
        case "property": {
          const raw = c.value;
          const value =
            typeof raw === "boolean" ? t(raw ? "cond.checked" : "cond.unchecked") : String(raw ?? "");
          return t("cond.property", {
            property: names.property?.(c.property_id) ?? t("cond.unknown_property"),
            value,
          });
        }
      }
      break;
    case "children_done":
      return c.stage ? t("cond.children_stage", { stage: c.stage }) : t("cond.children_all");
    case "pull_request":
      return t(c.event === "merged" ? "cond.pr_merged" : "cond.pr_checks");
    case "other_issue": {
      const issue = c.identifier || t("cond.another_issue");
      const key = c.state === "ended" ? "other_ended" : c.state === "in_review" ? "other_in_review" : "other_done";
      return t(`cond.${key}`, { issue });
    }
  }
  return t("unknown_condition");
}

/** Recurring schedule in words. Cron stays as expression + zone (no
 *  describer on mobile yet). */
export function wakeupScheduleText(w: Pick<WakeupLike, "kind" | "interval_seconds" | "cron_expression" | "timezone">): string {
  if (w.kind === "every") {
    const seconds = w.interval_seconds ?? 0;
    if (seconds === 3600) return t("time.hourly");
    if (seconds > 0 && seconds % 3600 === 0) return t("time.every_hours", { count: seconds / 3600 });
    if (seconds > 0 && seconds % 60 === 0) return t("time.every_minutes", { count: seconds / 60 });
    return t("time.every_seconds", { count: seconds });
  }
  const expr = w.cron_expression ?? "";
  return w.timezone ? t("time.cron_tz", { expr, tz: w.timezone }) : t("time.cron", { expr });
}

/**
 * Line 1 of a row: what the rule waits for, in plain words, for every
 * `kind`. `condition` wins over the kind, as on web.
 */
export function wakeupTriggerText(w: WakeupLike, names: WakeupNames = {}, now = new Date()): string {
  if (w.condition) return wakeupConditionText(w.condition, names);
  const kind: WakeupKind = w.kind;
  switch (kind) {
    case "at":
      return w.next_fire_at ? formatWakeupTime(w.next_fire_at, now) : t("time.at_unknown");
    case "every":
    case "cron":
      return wakeupScheduleText(w);
    case "event": {
      const events = w.event_types ?? [];
      if (events.length === 0) return t("unknown_event", { event: "–" });
      const first = events[0]!;
      let label = wakeupEventText(first, w.filter_agent_name);
      const actor = w.filter_actor_type
        ? w.filter_actor_name || t(w.filter_actor_type === "member" ? "selected_member" : "selected_agent")
        : null;
      if (actor && !first.startsWith("task.")) label = t("by_actor", { condition: label, actor });
      if (w.filter_task_id) label += ` · ${t("specific_run", { id: w.filter_task_id.slice(0, 8) })}`;
      return events.length > 1 ? `${label} +${events.length - 1}` : label;
    }
    default:
      return t("unknown_kind");
  }
}

/** Who set the rule up: "by admin" or "by planner (agent)". */
export function wakeupSourceText(
  w: Pick<MobileIssueWakeup, "created_by_name" | "created_by_agent" | "source_agent_name">,
): string | null {
  if (w.created_by_agent) {
    const agent = w.source_agent_name || w.created_by_name || t("agent_subject");
    return t("source_agent", { agent });
  }
  return w.created_by_name ? t("source_member", { name: w.created_by_name }) : null;
}

/** Deadline: "until 18 Oct, 08:00, then wake" / "…, then end", or the
 *  time it timed out. */
export function wakeupDeadlineText(
  w: Pick<MobileIssueWakeup, "expires_at" | "on_timeout" | "timed_out_at">,
  now = new Date(),
): string | null {
  if (w.timed_out_at) return t("deadline.timed_out", { time: formatWakeupTime(w.timed_out_at, now) });
  if (!w.expires_at) return null;
  const time = formatWakeupTime(w.expires_at, now);
  return t(w.on_timeout === "wake" ? "deadline.then_wake" : "deadline.then_end", { time });
}

/** Last run state in words; `null` while the rule never ran. */
export function wakeupRunStateText(status?: string | null): string | null {
  if (!status) return null;
  const key = `run_states.${status}`;
  return i18n.exists(`issues:wakeups.${key}`) ? t(key) : status;
}

/** Banner text for a rule the platform paused; `null` when not paused. */
export function wakeupPausedText(
  w: Pick<MobileIssueWakeup, "paused_reason" | "max_fires" | "fire_count">,
): string | null {
  if (!w.paused_reason) return null;
  const reason =
    w.paused_reason === "max_fires"
      ? t("paused.max_fires", { count: w.max_fires ?? w.fire_count ?? 0 })
      : w.paused_reason === "loop"
        ? t("paused.loop")
        : w.paused_reason === "rate"
          ? t("paused.rate")
          : t("paused.unknown");
  return t("paused.banner", { reason });
}

/**
 * Ended = no longer waits and was not paused or merely switched off: it
 * timed out, or a one-off rule already fired. Ended rows sit under
 * "Show ended (n)".
 */
export function isWakeupEnded(
  w: Pick<MobileIssueWakeup, "enabled" | "paused_reason" | "timed_out_at" | "mode" | "kind" | "last_task_id" | "disabled_at">,
): boolean {
  if (w.enabled || w.paused_reason) return false;
  if (w.timed_out_at) return true;
  return w.mode === "once" && !!w.last_task_id && !w.disabled_at;
}

type SortableWakeup = Parameters<typeof isWakeupEnded>[0] &
  Pick<MobileIssueWakeup, "next_fire_at" | "expires_at">;

/** Order inside "current": on → paused → off. */
function currentRank(w: SortableWakeup): number {
  if (w.paused_reason) return 1;
  return w.enabled ? 0 : 2;
}

/** When the rule is next due: its next fire time, else its deadline. */
function dueTime(w: SortableWakeup): number {
  const due = Date.parse(w.next_fire_at ?? w.expires_at ?? "");
  return Number.isFinite(due) ? due : Number.POSITIVE_INFINITY;
}

/**
 * Splits the list into current and ended rows, sorted for reading:
 * active rules first by next due time (overdue ones on top,
 * no time last), then paused, then switched off. The server answers
 * old → new, so ended rows are reversed to show the latest first. Ties
 * keep the server order.
 */
export function splitWakeups<T extends SortableWakeup>(rules: readonly T[]) {
  const current: T[] = [];
  const ended: T[] = [];
  for (const r of rules) (isWakeupEnded(r) ? ended : current).push(r);
  current.sort((a, b) => currentRank(a) - currentRank(b) || dueTime(a) - dueTime(b));
  ended.reverse();
  return { current, ended };
}

/** The "closed issues get no new wakeups" hint under the empty text:
 *  only for a done or cancelled issue, never for backlog/open. */
export function showWakeupClosedHint(category: string | null | undefined): boolean {
  return category === "done" || category === "closed";
}

/** Line 3 of a row (muted): deadline · source · last run. */
export function wakeupMetaText(w: MobileIssueWakeup, now = new Date()): string {
  return [wakeupDeadlineText(w, now), wakeupSourceText(w), wakeupRunStateText(w.last_task_status)]
    .filter(Boolean)
    .join(" · ");
}

/**
 * One TalkBack label per row: "Wakeup: tomorrow 09:00, wakes
 * planner, on, by admin. Instruction: …". Deadline and pause reason are
 * part of it, so nothing visible is missing for screen readers.
 */
export function wakeupRowA11yLabel(w: MobileIssueWakeup, names: WakeupNames = {}, now = new Date()): string {
  const parts = [
    wakeupTriggerText(w, names, now),
    t("wakes", { agent: w.agent_name || t("agent_subject") }),
    w.paused_reason ? t("state_paused") : t(w.enabled ? "state_on" : "state_off"),
    wakeupSourceText(w),
    wakeupDeadlineText(w, now),
    wakeupRunStateText(w.last_task_status),
  ].filter(Boolean);
  let label = t("row_a11y", { parts: parts.join(", ") });
  const paused = wakeupPausedText(w);
  if (paused) label += ` ${paused}.`;
  if (w.instruction.trim()) label += ` ${t("instruction_a11y", { text: w.instruction.trim() })}`;
  return label;
}

/** Header chip data for one issue; `null` hides the chip (active_count 0). */
export function wakeupChip(
  rows: readonly MobileIssueWakeupSummaryRow[] | undefined,
  issueId: string,
  now = Date.now(),
): { label: string; a11y: string } | null {
  const row = rows?.find((r) => r.issue_id === issueId);
  if (!row || row.active_count <= 0) return null;
  const next = row.next_fire_at ? formatRelativeIn(row.next_fire_at, now) : null;
  const count = row.active_count;
  if (row.next_fire_at && isOverdue(row.next_fire_at, now)) {
    return { label: t("chip.label_next", { count, next }), a11y: t("chip.a11y_overdue", { count }) };
  }
  return {
    label: next ? t("chip.label_next", { count, next }) : t("chip.label", { count }),
    a11y: next ? t("chip.a11y_next", { count, next }) : t("chip.a11y", { count }),
  };
}

export type WakeupSectionState = "loading" | "error" | "empty" | "ready";

/**
 * Which body the section shows. Reads the query status, not only the list:
 * the data layer turns an unreadable body into `[]`, so "no wakeups" must
 * not be inferred while the request failed (review note on #87). An error
 * with data still cached keeps the rows ("ready"; the section shows a banner).
 */
export function wakeupSectionState(q: {
  isPending: boolean;
  isError: boolean;
  data: readonly unknown[] | undefined;
}): WakeupSectionState {
  if (q.data && q.data.length > 0) return "ready";
  if (q.isError) return "error";
  if (q.isPending || !q.data) return "loading";
  return "empty";
}

/**
 * Whether the issue's Wakeups section opens by itself. Active rules or an
 * error open it; empty, loading or only switched-off rules keep it shut, and
 * so does a pending deep-link landing (`defaultOpen` false).
 *
 * Latched: once open it stays open, so switching off the
 * last active rule no longer folds the section away under the user's
 * finger; the row stays visible and can be switched back on right there.
 */
export function wakeupSectionAutoOpen(
  latched: boolean,
  p: { expand: boolean; defaultOpen: boolean; state: WakeupSectionState; hasActive: boolean },
): boolean {
  if (latched || p.expand) return true;
  return p.defaultOpen && (p.state === "error" || (p.state === "ready" && p.hasActive));
}
