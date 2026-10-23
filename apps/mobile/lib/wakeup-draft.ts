/**
 * Draft → request body for "+ Wakeup". Pure port of
 * the web `wakeup-draft.ts` (packages/views/issues/components) for these
 * choices: time (`at`, `every`, `cron` presets), "someone replies"
 * (`comment.created`), "a run ends" (task end), the
 * platform conditions (`children_done`, `issue_field`, `pull_request`,
 * `other_issue`) and custom events (`WAKEUP_EVENT_TYPES`).
 *
 * The server re-validates everything (service/issue_wakeup.go); these checks
 * only give the inline texts and the field to focus.
 */
import type { IssueWakeupInput, WakeupCondition } from "@multica/core/types";
import { checkWakeupInstruction } from "@/lib/wakeup-actions";

export type WakeupCreateCondition =
  | "at"
  | "recurring"
  | "reply"
  | "run_end"
  | "children"
  | "field"
  | "pull_request"
  | "other_issue"
  | "custom";
export type WakeupField = "status" | "assignee" | "label" | "property";
export type WakeupPrEvent = "checks_finished" | "merged";
export type WakeupOtherState = "done" | "ended" | "in_review";
export type WakeupAtPreset = "10m" | "1h" | "tomorrow" | "custom";
export type WakeupRecurrence = "hourly" | "daily" | "weekdays";
/** "Warten bis": no deadline, a number of days, or the end of a local day. */
export type WakeupWait =
  | { kind: "none" }
  | { kind: "days"; days: number }
  | { kind: "date"; date: string };

/** Step 1 groups in the order of spec §1.3. */
export const WAKEUP_CONDITION_GROUPS: {
  group: "time" | "collaboration" | "runs" | "linked" | "advanced";
  conditions: WakeupCreateCondition[];
}[] = [
  { group: "time", conditions: ["at", "recurring"] },
  { group: "collaboration", conditions: ["reply"] },
  { group: "runs", conditions: ["run_end", "children"] },
  { group: "linked", conditions: ["field", "pull_request", "other_issue"] },
  { group: "advanced", conditions: ["custom"] },
];
export const WAKEUP_FIELDS: WakeupField[] = ["status", "assignee", "label", "property"];
export const WAKEUP_PR_EVENTS: WakeupPrEvent[] = ["checks_finished", "merged"];
export const WAKEUP_OTHER_STATES: WakeupOtherState[] = ["done", "ended", "in_review"];

/** The issue-scoped events for "Eigene Ereignisse", in the server's catalog order (web `WAKEUP_EVENT_TYPES`). */
export const WAKEUP_EVENT_TYPES = [
  "task.queued",
  "task.dispatched",
  "task.started",
  "task.deferred",
  "task.waiting_local_directory",
  "task.completed",
  "task.failed",
  "task.cancelled",
  "issue.updated",
  "issue.status_changed",
  "issue.assignee_changed",
  "issue.parent_changed",
  "issue.project_changed",
  "issue.labels_changed",
  "issue.properties_changed",
  "issue.metadata_changed",
  "comment.created",
  "comment.updated",
  "comment.deleted",
  "comment.resolved",
  "comment.unresolved",
  "reaction.added",
  "reaction.removed",
  "attachment.attached",
  "attachment.detached",
] as const;
export type WakeupEventGroup = "task" | "issue" | "comment" | "reaction" | "attachment";
/** The catalog split by prefix, for the grouped list. */
export function wakeupEventGroups(): { group: WakeupEventGroup; events: string[] }[] {
  const groups: { group: WakeupEventGroup; events: string[] }[] = [];
  for (const event of WAKEUP_EVENT_TYPES) {
    const group = event.split(".")[0] as WakeupEventGroup;
    const last = groups[groups.length - 1];
    if (last?.group === group) last.events.push(event);
    else groups.push({ group, events: [event] });
  }
  return groups;
}
/** Toggles one event and keeps the catalog order (stable body). */
export function toggleWakeupEvent(events: readonly string[], event: string): string[] {
  const next = events.includes(event) ? events.filter((e) => e !== event) : [...events, event];
  return WAKEUP_EVENT_TYPES.filter((e) => next.includes(e));
}
export const WAKEUP_AT_PRESETS: WakeupAtPreset[] = ["10m", "1h", "tomorrow", "custom"];
export const WAKEUP_RECURRENCES: WakeupRecurrence[] = ["hourly", "daily", "weekdays"];
export const WAKEUP_WAIT_DAYS = [1, 3, 7, 30] as const;
export const WAKEUP_MAX_FIRES = [5, 10, 20, 50] as const;
const RUN_END_EVENTS = ["task.completed", "task.failed", "task.cancelled"];
const CRON: Record<Exclude<WakeupRecurrence, "hourly">, string> = {
  daily: "0 9 * * *",
  weekdays: "0 9 * * 1-5",
};

export interface WakeupCreateDraft {
  condition: WakeupCreateCondition | null;
  atPreset: WakeupAtPreset;
  /** ISO time from the date + time dialogs (device time). */
  atCustom: string | null;
  recurrence: WakeupRecurrence;
  /** `YYYY-MM-DD`; the rule ends at the end of that local day. */
  until: string;
  /** IANA zone for daily schedules; the device zone unless changed. */
  timezone: string;
  /** Null waits for anyone's reply. */
  replyActor: { type: "member" | "agent"; id: string } | null;
  /** Empty waits for any agent's run. */
  runAgentId: string;
  /** "Unteraufgaben fertig": null waits for every sub-issue. */
  stage: number | null;
  field: WakeupField;
  /** Status key, label id or property id, depending on `field`. */
  fieldTarget: string;
  /** Type of the chosen property (decides how `fieldValue` is sent). */
  propertyType: string;
  /** Property value; select options store their option id. */
  fieldValue: string;
  assignee: { type: "member" | "agent" | "squad"; id: string } | null;
  prEvent: WakeupPrEvent;
  otherIssue: { id: string; identifier: string; title?: string } | null;
  otherState: WakeupOtherState;
  /** "Eigene Ereignisse", in catalog order. */
  events: string[];
  agentId: string;
  instruction: string;
  mode: "once" | "continuous";
  /** Event rules: runs before the rule stops; recurring: null = no cap. */
  maxFires: number | null;
  wait: WakeupWait;
  onTimeout: "wake" | "end";
}

export type WakeupDraftError =
  | "missing_condition"
  | "missing_time"
  | "future_time"
  | "missing_value"
  | "missing_issue"
  | "missing_events"
  | "until_future"
  | "missing_agent"
  | "instruction_empty"
  | "instruction_too_long"
  | "wait_future";

/** Which field an error belongs to, so the sheet can focus it. */
export const WAKEUP_ERROR_FIELD: Record<
  WakeupDraftError,
  "condition" | "time" | "until" | "value" | "agent" | "instruction" | "wait"
> = {
  missing_condition: "condition",
  missing_time: "time",
  future_time: "time",
  missing_value: "value",
  missing_issue: "value",
  missing_events: "value",
  until_future: "until",
  missing_agent: "agent",
  instruction_empty: "instruction",
  instruction_too_long: "instruction",
  wait_future: "wait",
};

function pad(n: number) {
  return String(n).padStart(2, "0");
}

export function localDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** End of a local day as a Date; invalid input gives an invalid Date. */
export function endOfLocalDay(date: string): Date {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(`${date}T23:59:59`) : new Date(NaN);
}

/** Offset of `zone` against UTC at `at` in ms; null for an unknown zone. */
function zoneOffset(at: number, zone: string): number | null {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).formatToParts(new Date(at));
    const n = (type: string) => Number(parts.find((p) => p.type === type)?.value);
    const wall = Date.UTC(n("year"), n("month") - 1, n("day"), n("hour") % 24, n("minute"), n("second"));
    return Number.isFinite(wall) ? wall - Math.floor(at / 1000) * 1000 : null;
  } catch {
    return null;
  }
}

/**
 * End of a day in an IANA zone (23:59:59 there), so "Wiederholen bis" ends in
 * the zone the schedule runs in, not the device's (#128 review). An unknown
 * zone falls back to the device's local day.
 */
export function endOfDayInZone(date: string, zone: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return new Date(NaN);
  const wall = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 23, 59, 59);
  const first = zoneOffset(wall, zone);
  if (first === null) return endOfLocalDay(date);
  // A second pass lands on the right side of a DST switch near the end of day.
  const second = zoneOffset(wall - first, zone) ?? first;
  return new Date(wall - second);
}

/** The device's IANA zone; "UTC" when the runtime cannot tell. */
export function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/** Zones offered for "Zeitzone": the current one first, then common ones. */
const COMMON_ZONES = [
  "UTC",
  "Europe/Berlin",
  "Europe/London",
  "America/New_York",
  "America/Los_Angeles",
  "Asia/Shanghai",
  "Asia/Tokyo",
  "Australia/Sydney",
];
export function timeZoneChoices(current: string, device: string = deviceTimeZone()): string[] {
  return [...new Set([current, device, ...COMMON_ZONES].filter(Boolean))];
}

export function emptyWakeupDraft(
  agentId: string,
  timezone: string = deviceTimeZone(),
  now: Date = new Date(),
): WakeupCreateDraft {
  const until = new Date(now);
  until.setDate(until.getDate() + 7);
  return {
    condition: null,
    atPreset: "1h",
    atCustom: null,
    recurrence: "daily",
    until: localDate(until),
    timezone,
    replyActor: null,
    runAgentId: "",
    stage: null,
    field: "status",
    fieldTarget: "",
    propertyType: "",
    fieldValue: "",
    assignee: null,
    prEvent: "checks_finished",
    otherIssue: null,
    otherState: "done",
    events: [],
    agentId,
    instruction: "",
    mode: "once",
    maxFires: null,
    wait: { kind: "days", days: 7 },
    onTimeout: "wake",
  };
}

/** Waits for something to happen (mode, deadline, on_timeout apply). */
export function isEventCondition(c: WakeupCreateCondition | null): boolean {
  return !!c && c !== "at" && c !== "recurring";
}

/** A property value typed as the property stores it (web `propertyConditionValue`). */
export function propertyConditionValue(type: string | undefined, raw: string): unknown {
  if (type === "checkbox") return raw === "true";
  if (type === "number") {
    const n = Number(raw);
    return raw.trim() !== "" && Number.isFinite(n) ? n : raw;
  }
  return raw;
}

/** The platform-checked predicate for a condition choice, if it is one. */
export function platformCondition(
  d: WakeupCreateDraft,
): { condition: WakeupCondition } | { error: WakeupDraftError } | null {
  switch (d.condition) {
    case "field":
      if (d.field === "assignee") {
        return d.assignee
          ? { condition: { type: "issue_field", field: "assignee", assignee_type: d.assignee.type, assignee_id: d.assignee.id } }
          : { error: "missing_value" };
      }
      if (!d.fieldTarget) return { error: "missing_value" };
      if (d.field === "status") return { condition: { type: "issue_field", field: "status", value: d.fieldTarget } };
      if (d.field === "label") return { condition: { type: "issue_field", field: "label", label_id: d.fieldTarget } };
      if (!d.fieldValue.trim()) return { error: "missing_value" };
      return {
        condition: {
          type: "issue_field",
          field: "property",
          property_id: d.fieldTarget,
          value: propertyConditionValue(d.propertyType, d.fieldValue.trim()),
        },
      };
    case "children":
      return { condition: d.stage ? { type: "children_done", stage: d.stage } : { type: "children_done" } };
    case "pull_request":
      return { condition: { type: "pull_request", event: d.prEvent } };
    case "other_issue":
      return d.otherIssue
        ? { condition: { type: "other_issue", issue_id: d.otherIssue.id, state: d.otherState } }
        : { error: "missing_issue" };
    default:
      return null;
  }
}

/** Repeats (the "Höchstens … Läufe" field applies). */
export function repeats(d: Pick<WakeupCreateDraft, "condition" | "mode">): boolean {
  return d.condition === "recurring" || (isEventCondition(d.condition) && d.mode === "continuous");
}

/** Step 1 is done when the condition and its own value are set. */
export function stepOneError(d: WakeupCreateDraft, now: Date = new Date()): WakeupDraftError | null {
  if (!d.condition) return "missing_condition";
  if (d.condition === "at") {
    const at = atTime(d, now);
    if (!at) return "missing_time";
    if (at.getTime() <= now.getTime()) return "future_time";
  }
  if (d.condition === "recurring") {
    const end = endOfDayInZone(d.until, d.timezone);
    if (!Number.isFinite(end.getTime()) || end.getTime() <= now.getTime()) return "until_future";
  }
  const platform = platformCondition(d);
  if (platform && "error" in platform) return platform.error;
  if (d.condition === "custom" && d.events.length === 0) return "missing_events";
  return null;
}

/** The `at` time a preset stands for ("Morgen 09:00" = local 09:00). */
export function atTime(d: Pick<WakeupCreateDraft, "atPreset" | "atCustom">, now: Date = new Date()): Date | null {
  switch (d.atPreset) {
    case "10m":
      return new Date(now.getTime() + 10 * 60_000);
    case "1h":
      return new Date(now.getTime() + 60 * 60_000);
    case "tomorrow": {
      const at = new Date(now);
      at.setDate(at.getDate() + 1);
      at.setHours(9, 0, 0, 0);
      return at;
    }
    case "custom": {
      if (!d.atCustom) return null;
      const at = new Date(d.atCustom);
      return Number.isFinite(at.getTime()) ? at : null;
    }
  }
}

/** Maps the draft onto `POST /api/issues/{id}/wakeups`. */
export function buildWakeupInput(
  d: WakeupCreateDraft,
  now: Date = new Date(),
): { input: IssueWakeupInput } | { error: WakeupDraftError } {
  const first = stepOneError(d, now);
  if (first) return { error: first };
  if (!d.agentId) return { error: "missing_agent" };
  // Nothing to compare against on create: "" never equals a non-empty text.
  const check = checkWakeupInstruction(d.instruction, "");
  if (!check.ok) return { error: check.reason === "too_long" ? "instruction_too_long" : "instruction_empty" };
  const base = { agent_id: d.agentId, instruction: check.instruction };

  if (d.condition === "at") {
    return { input: { ...base, kind: "at", mode: "once", at: atTime(d, now)!.toISOString() } };
  }
  if (d.condition === "recurring") {
    const schedule: Pick<IssueWakeupInput, "kind" | "interval_seconds" | "cron_expression"> =
      d.recurrence === "hourly"
        ? { kind: "every", interval_seconds: 3600 }
        : { kind: "cron", cron_expression: CRON[d.recurrence] };
    const input: IssueWakeupInput = {
      ...base,
      ...schedule,
      mode: "continuous",
      timezone: d.timezone,
      expires_at: endOfDayInZone(d.until, d.timezone).toISOString(),
    };
    if (d.maxFires) input.max_fires = d.maxFires;
    return { input };
  }

  const input: IssueWakeupInput = { ...base, kind: "event", mode: d.mode };
  if (d.wait.kind === "days") {
    input.expires_in_seconds = d.wait.days * 86400;
    input.on_timeout = d.onTimeout;
  } else if (d.wait.kind === "date") {
    const end = endOfLocalDay(d.wait.date);
    if (!Number.isFinite(end.getTime()) || end.getTime() <= now.getTime()) return { error: "wait_future" };
    input.expires_at = end.toISOString();
    input.on_timeout = d.onTimeout;
  }
  if (d.mode === "continuous") input.max_fires = d.maxFires ?? 20;
  const platform = platformCondition(d);
  if (platform && "condition" in platform) {
    input.condition = platform.condition;
  } else if (d.condition === "reply") {
    input.event_types = ["comment.created"];
    if (d.replyActor) {
      input.filter_actor_type = d.replyActor.type;
      input.filter_actor_id = d.replyActor.id;
    }
  } else if (d.condition === "run_end") {
    input.event_types = RUN_END_EVENTS;
    if (d.runAgentId) input.filter_agent_id = d.runAgentId;
  } else {
    input.event_types = [...d.events];
  }
  return { input };
}

export type WakeupCreateErrorKind = "capacity" | "closed" | "forbidden" | "failed";

/**
 * Server answers for create. The server reports a full issue/workspace as
 * code `wakeup_capacity_exceeded` (400 today, handler/issue_wakeup.go); the
 * spec names 409/422, which are read the same way.
 */
export function wakeupCreateErrorKind(err: unknown): WakeupCreateErrorKind {
  const e = err as { status?: unknown; body?: unknown; message?: unknown } | null;
  const body = e?.body && typeof e.body === "object" ? (e.body as Record<string, unknown>) : null;
  const code = typeof body?.code === "string" ? body.code : "";
  const text = [body?.error, e?.message].filter((v) => typeof v === "string").join(" ").toLowerCase();
  if (code === "wakeup_capacity_exceeded" || e?.status === 409 || e?.status === 422) return "capacity";
  if (e?.status === 403) return "forbidden";
  if (e?.status === 400 && /closed/.test(text)) return "closed";
  return "failed";
}

/** Agents a rule can wake: not archived and bound to a runtime. */
export function wakeableAgents<A extends { id: string; runtime_id?: string | null; runtime_bound?: boolean; archived_at?: string | null }>(
  agents: A[],
): A[] {
  return agents.filter(
    (a) => !a.archived_at && a.runtime_bound !== false && (a.runtime_id ?? "").trim().length > 0,
  );
}
