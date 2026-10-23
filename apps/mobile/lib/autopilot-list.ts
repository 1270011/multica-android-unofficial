/**
 * Autopilot list logic.
 * Pure functions for the "Autopilots" segment: status filter + search, the
 * row actions (hidden without write access) and the "run now" toast per
 * run status. The screen in components/autopilots/ only renders these.
 */
import type {
  AutopilotRunStatusValue,
  MobileAutopilot,
  MobileAutopilotRun,
} from "@/data/autopilot-schemas";

// --- Status filter chips (Aktiv n · Pausiert n · Alle) ---

export type AutopilotFilter = "active" | "paused" | "all";

export const AUTOPILOT_FILTERS: readonly AutopilotFilter[] = ["active", "paused", "all"];

/** Chip counts; filtered client-side, the list is fetched once. */
export function autopilotFilterCounts(rows: readonly MobileAutopilot[]): Record<AutopilotFilter, number> {
  let active = 0;
  let paused = 0;
  for (const a of rows) {
    if (a.status === "active") active += 1;
    else if (a.status === "paused") paused += 1;
  }
  return { active, paused, all: rows.length };
}

/** Lowercased, whitespace-collapsed search text. */
export function normalizeQuery(query: string): string {
  return query.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

/**
 * Rows for the chip and the title search (§2.2 "Suche im Titel"), sorted
 * by title. Archived and unknown statuses only show under "Alle".
 */
export function filterAutopilots(
  rows: readonly MobileAutopilot[],
  filter: AutopilotFilter,
  query: string,
): MobileAutopilot[] {
  const q = normalizeQuery(query);
  return rows
    .filter((a) => filter === "all" || a.status === filter)
    .filter((a) => q === "" || a.title.toLocaleLowerCase().includes(q))
    .sort((a, b) => a.title.localeCompare(b.title));
}

// --- Row actions (overflow "⋯" + accessibilityActions) ---

export type AutopilotAction = "run" | "pause" | "resume" | "runs" | "delete";

/**
 * Actions of a row. `can_write === false` leaves none (A2 acceptance:
 * "Aktionen fehlen ohne Rechte"; §0.2 hides instead of greying out);
 * `undefined` means the server decides, so the actions stay. The runs
 * jump is read-only and stays for everyone. Pause and resume only for
 * the statuses a client may set; an archived or unknown autopilot can
 * still be run, opened and deleted.
 */
export function autopilotActions(
  a: Pick<MobileAutopilot, "status" | "can_write">,
): AutopilotAction[] {
  if (a.can_write === false) return ["runs"];
  const actions: AutopilotAction[] = ["run"];
  if (a.status === "active") actions.push("pause");
  else if (a.status === "paused") actions.push("resume");
  actions.push("runs", "delete");
  return actions;
}

/** Whether the row shows the "⋯" button at all (only write actions count). */
export function hasWriteActions(a: Pick<MobileAutopilot, "status" | "can_write">): boolean {
  return autopilotActions(a).some((x) => x !== "runs");
}

// --- "Run now" outcome → toast ---

export type RunToastTone = "success" | "warning" | "error" | "neutral";

/** i18n key under `workspace:autopilot.reason.*` for a skipped run. */
export type SkipReasonKey =
  | "invocation_not_allowed"
  | "runtime_offline"
  | "agent_runtime_required"
  | "runtime_access_denied"
  | "target_unavailable"
  | "attribution_blocked"
  | "already_active"
  | "quota_exceeded"
  | "issue_limit_reached"
  | "generic";

const SKIP_REASONS = new Set<string>([
  "invocation_not_allowed",
  "runtime_offline",
  "agent_runtime_required",
  "runtime_access_denied",
  "target_unavailable",
  "attribution_blocked",
  "already_active",
  "quota_exceeded",
  "issue_limit_reached",
]);

/** Server reason codes as in packages/views/autopilots run-now-toast.ts. */
export function skipReasonKey(reasonCode: string | null | undefined): SkipReasonKey {
  return reasonCode && SKIP_REASONS.has(reasonCode) ? (reasonCode as SkipReasonKey) : "generic";
}

export interface RunToast {
  tone: RunToastTone;
  /** Key under `workspace:autopilot.run_toast.*`. */
  key: AutopilotRunStatusValue | "no_result";
  /** Interpolation values; `reason` is an i18n key under `autopilot.reason`. */
  params: { reason?: SkipReasonKey; failure?: string; status?: string };
  /** Optional toast button. */
  action: "open_issue" | null;
}

/**
 * Toast for the answer of `POST /api/autopilots/{id}/trigger`. Success is a
 * whitelist (`issue_created`, `running`, `completed`); `skipped` is a
 * warning with its reason, never success; anything unknown is neutral with
 * the raw status; a missing body (`null`) is neutral, not success.
 */
export function runNowToast(run: MobileAutopilotRun | null): RunToast {
  if (!run) return { tone: "neutral", key: "no_result", params: {}, action: null };
  switch (run.status) {
    case "issue_created":
      return {
        tone: "success",
        key: "issue_created",
        params: {},
        action: run.issue_id ? "open_issue" : null,
      };
    case "running":
      return { tone: "success", key: "running", params: {}, action: null };
    case "completed":
      return { tone: "success", key: "completed", params: {}, action: null };
    case "skipped":
      return {
        tone: "warning",
        key: "skipped",
        params: { reason: skipReasonKey(run.reason_code) },
        action: null,
      };
    case "failed":
      return {
        tone: "error",
        key: "failed",
        params: { failure: run.failure_reason ?? "" },
        action: null,
      };
    case "unknown":
      return {
        tone: "neutral",
        key: "unknown",
        params: { status: run.raw_status || "?" },
        action: null,
      };
  }
}

// --- Times ("Nächster: heute 02:00") ---

export type DayBucket = "today" | "tomorrow" | "yesterday" | "other";

/** Calendar day of `iso` relative to `now`, in the device time zone. */
export function dayBucket(iso: string, now: Date = new Date()): DayBucket | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const day = (x: Date) => Date.UTC(x.getFullYear(), x.getMonth(), x.getDate()) / 86_400_000;
  const diff = day(d) - day(now);
  if (diff === 0) return "today";
  if (diff === 1) return "tomorrow";
  if (diff === -1) return "yesterday";
  return "other";
}

// --- "Next" run on the row ---

/** The next run time worth showing: none for a paused/archived autopilot
 *  (the server keeps its stale `next_run_at`) and none once it lies in the
 *  past ("Next: yesterday 7:00 AM"). */
export function visibleNextRun(a: MobileAutopilot, now: number = Date.now()): string | null {
  if (a.status !== "active" || !a.next_run_at) return null;
  const at = Date.parse(a.next_run_at);
  if (Number.isNaN(at) || at < now) return null;
  return a.next_run_at;
}
