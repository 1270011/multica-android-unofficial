// @vitest-environment node
import { InfiniteQueryObserver, QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "@/data/api";
import {
  AutopilotRunListSchema,
  AutopilotRunSchema,
  type MobileAutopilotRun,
  type MobileAutopilotRunList,
} from "@/data/autopilot-schemas";
import { autopilotRunsOptions } from "@/data/queries/autopilots";
import {
  autopilotRunHref,
  autopilotRunsHref,
  flattenRunPages,
  formatRunDuration,
  formatRunJson,
  jsonBlockWraps,
  runDurationMs,
  runIssueHref,
  runReason,
  runsListState,
  runSourceLabel,
  runStatusLabel,
  runTaskHref,
  runTone,
} from "./autopilot-runs";

vi.mock("@/data/api", () => ({ api: { listAutopilotRuns: vi.fn() } }));

/** Echo translator: key plus options, so tests see which text was picked. */
const t = (key: string, options?: Record<string, unknown>) =>
  options ? `${key} ${JSON.stringify(options)}` : key;

const run = (over: Partial<MobileAutopilotRun> = {}): MobileAutopilotRun => ({
  id: "r1",
  autopilot_id: "ap1",
  trigger_id: null,
  source: "schedule",
  raw_source: "schedule",
  status: "completed",
  raw_status: "completed",
  issue_id: null,
  task_id: null,
  triggered_at: "2026-10-18T02:00:00Z",
  completed_at: "2026-10-18T02:03:05Z",
  failure_reason: null,
  reason_code: undefined,
  trigger_payload: null,
  result: null,
  created_at: "2026-10-18T02:00:00Z",
  ...over,
});

const page = (from: number, n: number): MobileAutopilotRunList => ({
  runs: Array.from({ length: n }, (_, i) => run({ id: `r${from + i}` })),
  total: n,
});

describe("Weitere laden (runs paging)", () => {
  let qc: QueryClient;
  beforeEach(() => {
    qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });
  afterEach(() => {
    qc.clear();
    vi.clearAllMocks();
  });

  it("loads the next page with offset 20 and appends it", async () => {
    vi.mocked(api.listAutopilotRuns)
      .mockResolvedValueOnce(page(0, 20))
      .mockResolvedValueOnce(page(20, 5));
    const observer = new InfiniteQueryObserver(qc, autopilotRunsOptions("ws-1", "ap1"));
    const unsubscribe = observer.subscribe(() => {});

    await vi.waitFor(() => expect(observer.getCurrentResult().isSuccess).toBe(true));
    let result = observer.getCurrentResult();
    expect(flattenRunPages(result.data?.pages)).toHaveLength(20);
    expect(result.hasNextPage).toBe(true);
    expect(api.listAutopilotRuns).toHaveBeenLastCalledWith(
      "ap1",
      { limit: 20, offset: 0 },
      expect.anything(),
    );

    await observer.fetchNextPage();
    result = observer.getCurrentResult();
    expect(api.listAutopilotRuns).toHaveBeenLastCalledWith(
      "ap1",
      { limit: 20, offset: 20 },
      expect.anything(),
    );
    const rows = flattenRunPages(result.data?.pages);
    expect(rows).toHaveLength(25);
    expect(rows[24]?.id).toBe("r24");
    // A short page ends the list: no "Weitere laden" any more.
    expect(result.hasNextPage).toBe(false);
    unsubscribe();
  });

  it("offers no next page when the first page is short", async () => {
    vi.mocked(api.listAutopilotRuns).mockResolvedValueOnce(page(0, 3));
    const observer = new InfiniteQueryObserver(qc, autopilotRunsOptions("ws-1", "ap1"));
    const unsubscribe = observer.subscribe(() => {});
    await vi.waitFor(() => expect(observer.getCurrentResult().isSuccess).toBe(true));
    expect(observer.getCurrentResult().hasNextPage).toBe(false);
    unsubscribe();
  });
});

describe("flattenRunPages", () => {
  it("drops rows that a shifted offset repeats", () => {
    const rows = flattenRunPages([
      { runs: [run({ id: "a" }), run({ id: "b" })] },
      { runs: [run({ id: "b" }), run({ id: "c" })] },
    ]);
    expect(rows.map((r) => r.id)).toEqual(["a", "b", "c"]);
  });

  it("handles no data", () => {
    expect(flattenRunPages(undefined)).toEqual([]);
  });
});

describe("runsListState", () => {
  it("picks loading, error, empty and list", () => {
    expect(runsListState({ isLoading: true, isError: false, rows: 0 })).toBe("loading");
    expect(runsListState({ isLoading: false, isError: true, rows: 0 })).toBe("error");
    expect(runsListState({ isLoading: false, isError: false, rows: 0 })).toBe("empty");
    expect(runsListState({ isLoading: false, isError: false, rows: 3 })).toBe("list");
  });

  it("keeps loaded rows on a later error", () => {
    expect(runsListState({ isLoading: false, isError: true, rows: 3 })).toBe("list");
  });
});

describe("status and source", () => {
  it("translates known statuses", () => {
    expect(runStatusLabel(run({ status: "skipped", raw_status: "skipped" }), t)).toBe(
      "autopilot.runs.status.skipped",
    );
    expect(runTone("skipped")).toBe("warning");
    expect(runTone("failed")).toBe("danger");
    expect(runTone("issue_created")).toBe("success");
  });

  it("shows an unknown status as raw text without crashing", () => {
    const parsed = AutopilotRunSchema.parse({ id: "x", status: "throttled", source: "cron" });
    expect(parsed.status).toBe("unknown");
    expect(runStatusLabel(parsed, t)).toBe("throttled");
    expect(runTone(parsed.status)).toBe("muted");
    expect(runSourceLabel(parsed, t)).toBe("cron");
  });

  it("survives a missing or non-string status", () => {
    const parsed = AutopilotRunSchema.parse({ id: "x", status: 42, source: null });
    expect(runStatusLabel(parsed, t)).toBe("?");
    expect(runSourceLabel(parsed, t)).toBe("");
    expect(runTone("whatever" as never)).toBe("muted");
  });

  it("keeps a list with odd rows usable", () => {
    const list = AutopilotRunListSchema.parse({
      runs: [{ id: "a", status: "new_state" }, { status: "completed" }, { id: "c", status: "completed" }],
      total: 3,
    });
    expect(list.runs.map((r) => r.id)).toContain("c");
    expect(list.runs.find((r) => r.id === "a")?.status).toBe("unknown");
  });

  it("translates sources", () => {
    expect(runSourceLabel(run({ source: "manual" }), t)).toBe("autopilot.runs.source.manual");
  });
});

describe("duration", () => {
  it("measures finished runs only", () => {
    expect(runDurationMs(run())).toBe(185_000);
    expect(runDurationMs(run({ completed_at: null }))).toBeNull();
    expect(runDurationMs(run({ completed_at: "kaputt" }))).toBeNull();
    expect(runDurationMs(run({ completed_at: "2026-10-18T01:00:00Z" }))).toBeNull();
  });

  it("formats seconds, minutes and hours", () => {
    expect(formatRunDuration(400, t)).toBe("autopilot.runs.duration_lt_1s");
    expect(formatRunDuration(42_000, t)).toBe('autopilot.runs.duration_s {"count":42}');
    expect(formatRunDuration(185_000, t)).toBe('autopilot.runs.duration_m_s {"m":3,"s":5}');
    expect(formatRunDuration(7_800_000, t)).toBe('autopilot.runs.duration_h_m {"h":2,"m":10}');
  });
});

describe("runReason", () => {
  it("translates a known reason code first", () => {
    expect(
      runReason(run({ status: "skipped", reason_code: "runtime_offline", failure_reason: "offline" }), t),
    ).toBe("autopilot.reason.runtime_offline");
  });

  it("falls back to failure_reason", () => {
    expect(runReason(run({ status: "failed", reason_code: "brand_new", failure_reason: " boom " }), t)).toBe(
      "boom",
    );
  });

  it("gives a skip without anything the generic text, a success none", () => {
    expect(runReason(run({ status: "skipped" }), t)).toBe("autopilot.reason.generic");
    expect(runReason(run({ status: "completed" }), t)).toBeNull();
  });
});

describe("formatRunJson", () => {
  it("pretty-prints objects", () => {
    expect(formatRunJson({ a: 1, b: [true] })).toBe('{\n  "a": 1,\n  "b": [\n    true\n  ]\n}');
  });

  it("parses JSON strings and keeps other strings", () => {
    expect(formatRunJson('{"x":1}')).toBe('{\n  "x": 1\n}');
    expect(formatRunJson("plain text")).toBe("plain text");
  });

  it("returns null for nothing", () => {
    expect(formatRunJson(null)).toBeNull();
    expect(formatRunJson(undefined)).toBeNull();
    expect(formatRunJson("  ")).toBeNull();
  });

  it("never throws on values JSON cannot hold", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(formatRunJson(cyclic)).toBe("[object Object]");
    expect(formatRunJson(10n)).toBe("10");
  });
});

describe("JSON block layout", () => {
  it("scrolls sideways at normal size and wraps when enlarged", () => {
    expect(jsonBlockWraps(1)).toBe(false);
    expect(jsonBlockWraps(1.15)).toBe(false);
    expect(jsonBlockWraps(1.3)).toBe(true);
    expect(jsonBlockWraps(2)).toBe(true);
  });
});

describe("links", () => {
  it("builds runs, run, issue and task links", () => {
    expect(autopilotRunsHref("ws", "ap 1")).toBe("/ws/autopilots/ap%201/runs");
    expect(autopilotRunHref("ws", "ap1", "r1")).toBe("/ws/autopilots/ap1/runs/r1");
    expect(runIssueHref("ws", run({ issue_id: "i1" }))).toBe("/ws/issue/i1");
    expect(runIssueHref("ws", run())).toBeNull();
    expect(runTaskHref("ws", run({ issue_id: "i1", task_id: "t1" }))).toBe("/ws/issue/i1/runs");
    expect(runTaskHref("ws", run({ task_id: "t1" }))).toBeNull();
  });
});
