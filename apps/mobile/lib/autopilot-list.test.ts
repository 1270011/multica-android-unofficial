import { describe, expect, it } from "vitest";
import { AutopilotRunSchema, AutopilotSchema, type MobileAutopilot } from "@/data/autopilot-schemas";
import {
  autopilotActions,
  autopilotFilterCounts,
  dayBucket,
  filterAutopilots,
  hasWriteActions,
  runNowToast,
  skipReasonKey,
  visibleNextRun,
} from "./autopilot-list";

function ap(over: Record<string, unknown>): MobileAutopilot {
  return AutopilotSchema.parse({ id: "a", title: "A", status: "active", ...over });
}

function run(over: Record<string, unknown>) {
  return AutopilotRunSchema.parse({ id: "r", status: "running", source: "manual", ...over });
}

describe("filterAutopilots", () => {
  const rows = [
    ap({ id: "1", title: "Wochenbericht", status: "paused" }),
    ap({ id: "2", title: "Nachtlauf Regression", status: "active" }),
    ap({ id: "3", title: "Alt", status: "archived" }),
    ap({ id: "4", title: "Neu", status: "frozen" }),
  ];

  it("counts per chip", () => {
    expect(autopilotFilterCounts(rows)).toEqual({ active: 1, paused: 1, all: 4 });
  });

  it("filters by status; archived and unknown only under all", () => {
    expect(filterAutopilots(rows, "active", "").map((a) => a.id)).toEqual(["2"]);
    expect(filterAutopilots(rows, "paused", "").map((a) => a.id)).toEqual(["1"]);
    expect(filterAutopilots(rows, "all", "").map((a) => a.id)).toEqual(["3", "2", "4", "1"]);
  });

  it("searches the title case-insensitively with collapsed spaces", () => {
    expect(filterAutopilots(rows, "all", "  nachtLAUF   regr ").map((a) => a.id)).toEqual(["2"]);
    expect(filterAutopilots(rows, "paused", "nacht")).toEqual([]);
  });
});

describe("autopilotActions", () => {
  it("offers run, pause, runs, delete for an active autopilot", () => {
    expect(autopilotActions(ap({ status: "active", can_write: true }))).toEqual([
      "run",
      "pause",
      "runs",
      "delete",
    ]);
  });

  it("offers resume for a paused one", () => {
    expect(autopilotActions(ap({ status: "paused" }))).toEqual(["run", "resume", "runs", "delete"]);
  });

  it("keeps the actions when can_write is absent (server decides)", () => {
    const a = ap({ status: "active" });
    expect(a.can_write).toBeUndefined();
    expect(hasWriteActions(a)).toBe(true);
  });

  it("hides every write action when can_write is false", () => {
    const a = ap({ status: "active", can_write: false });
    expect(autopilotActions(a)).toEqual(["runs"]);
    expect(hasWriteActions(a)).toBe(false);
  });

  it("has no pause/resume for archived or unknown statuses", () => {
    expect(autopilotActions(ap({ status: "archived" }))).toEqual(["run", "runs", "delete"]);
    expect(autopilotActions(ap({ status: "frozen" }))).toEqual(["run", "runs", "delete"]);
  });
});

describe("runNowToast", () => {
  it("issue_created is success with an open button when the issue is known", () => {
    expect(runNowToast(run({ status: "issue_created", issue_id: "i1" }))).toEqual({
      tone: "success",
      key: "issue_created",
      params: {},
      action: "open_issue",
    });
    expect(runNowToast(run({ status: "issue_created" })).action).toBeNull();
  });

  it("running and completed are success", () => {
    expect(runNowToast(run({ status: "running" }))).toMatchObject({ tone: "success", key: "running" });
    expect(runNowToast(run({ status: "completed" }))).toMatchObject({
      tone: "success",
      key: "completed",
    });
  });

  it("skipped is a warning with its reason, never success", () => {
    expect(runNowToast(run({ status: "skipped", reason_code: "runtime_offline" }))).toEqual({
      tone: "warning",
      key: "skipped",
      params: { reason: "runtime_offline" },
      action: null,
    });
    expect(runNowToast(run({ status: "skipped" })).params.reason).toBe("generic");
  });

  it("failed is an error with the failure reason", () => {
    expect(runNowToast(run({ status: "failed", failure_reason: "boom" }))).toEqual({
      tone: "error",
      key: "failed",
      params: { failure: "boom" },
      action: null,
    });
    expect(runNowToast(run({ status: "failed" })).params.failure).toBe("");
  });

  it("an unknown status is neutral with the raw text", () => {
    expect(runNowToast(run({ status: "deferred" }))).toEqual({
      tone: "neutral",
      key: "unknown",
      params: { status: "deferred" },
      action: null,
    });
    expect(runNowToast(run({ status: 42 })).params.status).toBe("?");
  });

  it("an unusable body is neutral, not success", () => {
    expect(runNowToast(null)).toMatchObject({ tone: "neutral", key: "no_result" });
  });

  it("covers every run status the schema can produce", () => {
    for (const status of ["issue_created", "running", "completed", "failed", "skipped", "x"]) {
      expect(runNowToast(run({ status })).key).toBe(status === "x" ? "unknown" : status);
    }
  });
});

describe("skipReasonKey", () => {
  it("maps known codes and degrades the rest to generic", () => {
    for (const code of [
      "invocation_not_allowed",
      "runtime_offline",
      "agent_runtime_required",
      "runtime_access_denied",
      "target_unavailable",
      "attribution_blocked",
      "already_active",
      "quota_exceeded",
      "issue_limit_reached",
    ]) {
      expect(skipReasonKey(code)).toBe(code);
    }
    expect(skipReasonKey("something_new")).toBe("generic");
    expect(skipReasonKey(undefined)).toBe("generic");
    expect(skipReasonKey(null)).toBe("generic");
  });
});

describe("dayBucket", () => {
  const now = new Date(2026, 9, 18, 12, 0);
  it("buckets by calendar day", () => {
    expect(dayBucket(new Date(2026, 9, 18, 23, 59).toISOString(), now)).toBe("today");
    expect(dayBucket(new Date(2026, 9, 19, 2, 0).toISOString(), now)).toBe("tomorrow");
    expect(dayBucket(new Date(2026, 9, 17, 2, 0).toISOString(), now)).toBe("yesterday");
    expect(dayBucket(new Date(2026, 9, 25, 2, 0).toISOString(), now)).toBe("other");
  });
  it("returns null for unreadable dates", () => {
    expect(dayBucket("nope", now)).toBeNull();
  });
});

describe("visibleNextRun", () => {
  const now = Date.parse("2026-10-20T12:00:00Z");
  it("shows a future run of an active autopilot", () => {
    expect(visibleNextRun(ap({ next_run_at: "2026-10-21T07:00:00Z" }), now)).toBe("2026-10-21T07:00:00Z");
  });
  it("hides it while paused", () => {
    expect(visibleNextRun(ap({ status: "paused", next_run_at: "2026-10-21T07:00:00Z" }), now)).toBeNull();
  });
  it("hides a run in the past", () => {
    expect(visibleNextRun(ap({ next_run_at: "2026-10-19T07:00:00Z" }), now)).toBeNull();
  });
  it("hides a missing or unreadable time", () => {
    expect(visibleNextRun(ap({}), now)).toBeNull();
    expect(visibleNextRun(ap({ next_run_at: "soon" }), now)).toBeNull();
  });
});
