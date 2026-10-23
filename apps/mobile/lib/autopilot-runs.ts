/**
 * Autopilot runs logic.
 * Pure functions for the runs list and the run sheet: status and source as
 * text (unknown values as raw text, never a crash), duration, the reason
 * (`reason_code` translated, otherwise `failure_reason`) and the JSON block
 * for `trigger_payload` / `result`.
 *
 * Everything here is read-only; the runs screens trigger nothing.
 */
import type {
  AutopilotRunStatusValue,
  MobileAutopilotRun,
  MobileAutopilotRunList,
} from "@/data/autopilot-schemas";
import { skipReasonKey } from "@/lib/autopilot-list";

type Translate = (key: string, options?: Record<string, unknown>) => string;

// --- Pages ------------------------------------------------------------------

/**
 * All loaded pages as one list. Offset paging can repeat a row when a new
 * run arrives between two pages; the first occurrence wins.
 */
export function flattenRunPages(
  pages: readonly Pick<MobileAutopilotRunList, "runs">[] | undefined,
): MobileAutopilotRun[] {
  const seen = new Set<string>();
  const out: MobileAutopilotRun[] = [];
  for (const page of pages ?? []) {
    for (const run of page.runs) {
      if (seen.has(run.id)) continue;
      seen.add(run.id);
      out.push(run);
    }
  }
  return out;
}

export type RunsListState = "loading" | "error" | "empty" | "list";

/** Which body the runs list shows. Rows already loaded win over an error. */
export function runsListState(q: {
  isLoading: boolean;
  isError: boolean;
  rows: number;
}): RunsListState {
  if (q.rows > 0) return "list";
  if (q.isLoading) return "loading";
  if (q.isError) return "error";
  return "empty";
}

// --- Status and source --------------------------------------------------------

export type RunTone = "success" | "running" | "warning" | "danger" | "muted";

const STATUS_TONE: Record<AutopilotRunStatusValue, RunTone> = {
  issue_created: "success",
  completed: "success",
  running: "running",
  skipped: "warning",
  failed: "danger",
  unknown: "muted",
};

export function runTone(status: AutopilotRunStatusValue): RunTone {
  return STATUS_TONE[status] ?? "muted";
}

/** "Issue angelegt", "Übersprungen" … ; an unknown status shows its raw text. */
export function runStatusLabel(
  run: Pick<MobileAutopilotRun, "status" | "raw_status">,
  t: Translate,
): string {
  if (run.status === "unknown" || !(run.status in STATUS_TONE)) return run.raw_status || "?";
  return t(`autopilot.runs.status.${run.status}`);
}

/** "Zeitplan", "Manuell", "Webhook", "API"; unknown = raw text (or nothing). */
export function runSourceLabel(
  run: Pick<MobileAutopilotRun, "source" | "raw_source">,
  t: Translate,
): string {
  if (run.source === "unknown") return run.raw_source;
  return t(`autopilot.runs.source.${run.source}`);
}

// --- Times --------------------------------------------------------------------

/** Run duration; null while it runs or when a time is missing or broken. */
export function runDurationMs(
  run: Pick<MobileAutopilotRun, "triggered_at" | "completed_at">,
): number | null {
  if (!run.triggered_at || !run.completed_at) return null;
  const start = Date.parse(run.triggered_at);
  const end = Date.parse(run.completed_at);
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return null;
  return end - start;
}

/** "< 1 s", "42 s", "3 Min 5 s", "2 Std 10 Min". */
export function formatRunDuration(ms: number, t: Translate): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 1) return t("autopilot.runs.duration_lt_1s");
  if (seconds < 60) return t("autopilot.runs.duration_s", { count: seconds });
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return t("autopilot.runs.duration_m_s", { m: minutes, s: seconds % 60 });
  return t("autopilot.runs.duration_h_m", { h: Math.floor(minutes / 60), m: minutes % 60 });
}

// --- Reason -------------------------------------------------------------------

/**
 * Why a run was skipped or failed: a known `reason_code` translated,
 * otherwise the server's `failure_reason`; a skip without either gets the
 * generic text. Successful runs have no reason.
 */
export function runReason(
  run: Pick<MobileAutopilotRun, "status" | "reason_code" | "failure_reason">,
  t: Translate,
): string | null {
  const key = skipReasonKey(run.reason_code);
  if (key !== "generic") return t(`autopilot.reason.${key}`);
  const failure = run.failure_reason?.trim();
  if (failure) return failure;
  if (run.status === "skipped") return t("autopilot.reason.generic");
  return null;
}

// --- JSON block ------------------------------------------------------------------

/**
 * Pretty JSON for `trigger_payload` / `result`. A string that holds JSON is
 * parsed first; anything that cannot be serialised falls back to its
 * string form. `null` = nothing to show.
 */
export function formatRunJson(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "") return null;
    try {
      return JSON.stringify(JSON.parse(trimmed), null, 2);
    } catch {
      return value;
    }
  }
  try {
    const text = JSON.stringify(value, null, 2);
    return text === undefined ? String(value) : text;
  } catch {
    return String(value);
  }
}

/** From this font scale on the JSON block wraps instead of scrolling sideways. */
export const JSON_WRAP_FONT_SCALE = 1.3;

export function jsonBlockWraps(fontScale: number): boolean {
  return fontScale >= JSON_WRAP_FONT_SCALE;
}

// --- Links ----------------------------------------------------------------------

export function autopilotRunsHref(wsSlug: string, autopilotId: string): string {
  return `/${wsSlug}/autopilots/${encodeURIComponent(autopilotId)}/runs`;
}

export function autopilotRunHref(wsSlug: string, autopilotId: string, runId: string): string {
  return `${autopilotRunsHref(wsSlug, autopilotId)}/${encodeURIComponent(runId)}`;
}

/** Issue the run created; null when it has none. */
export function runIssueHref(wsSlug: string, run: Pick<MobileAutopilotRun, "issue_id">): string | null {
  return run.issue_id ? `/${wsSlug}/issue/${run.issue_id}` : null;
}

/** Task view (the issue's runs sheet) when the run started an agent task. */
export function runTaskHref(
  wsSlug: string,
  run: Pick<MobileAutopilotRun, "issue_id" | "task_id">,
): string | null {
  return run.issue_id && run.task_id ? `/${wsSlug}/issue/${run.issue_id}/runs` : null;
}
