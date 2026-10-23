// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import type { Agent, AgentTask } from "@multica/core/types";
import { i18n } from "./i18n/singleton";
import { RUNTIME_QUEUE_STATUSES, runtimeQueue } from "./runtime-machines";
import {
  activityBars,
  activitySummaryText,
  busiestWindow,
  queueWaitText,
  runtimeAgentRows,
  runtimeAgentWorkText,
  runtimeStatusLine,
  runtimeStuckReason,
  runtimeStuckText,
} from "./runtime-detail";

const NOW = Date.parse("2026-10-18T12:00:00Z");
const MIN = 60_000;
const ago = (ms: number) => new Date(NOW - ms).toISOString();

const agent = (id: string, runtime_id: string, o: Partial<Agent> = {}) =>
  ({ id, name: id, runtime_id, archived_at: null, ...o }) as Agent;
const task = (agent_id: string, status: string, minutesAgo: number, o: Partial<AgentTask> = {}) =>
  ({
    id: `${agent_id}-${status}-${minutesAgo}`,
    agent_id,
    runtime_id: "",
    issue_id: "",
    status,
    created_at: ago(minutesAgo * MIN),
    ...o,
  }) as AgentTask;

const ALL_STATUSES = [
  "queued",
  "dispatched",
  "waiting_local_directory",
  "deferred",
  "running",
  "completed",
  "failed",
  "cancelled",
];

afterEach(() => {
  void i18n.changeLanguage("de");
});

describe("runtimeStuckReason (card only when action is needed)", () => {
  const queued = [task("a", "queued", 40)];

  it("online with an empty queue: no card", () => {
    expect(runtimeStuckReason({ health: "online", lastSeenAt: ago(0), queue: [], running: 2, now: NOW })).toBeNull();
  });

  it("online with a fresh queue (≤ 2 min): no card", () => {
    const fresh = [task("a", "queued", 1)];
    expect(runtimeStuckReason({ health: "online", lastSeenAt: ago(0), queue: fresh, running: 0, now: NOW })).toBeNull();
  });

  it("online with a queue waiting > 2 min: card 'evtl. ausgelastet'", () => {
    expect(runtimeStuckReason({ health: "online", lastSeenAt: ago(0), queue: queued, running: 0, now: NOW })).toEqual({
      kind: "online_waiting",
      count: 1,
      oldestAt: queued[0]!.created_at,
    });
  });

  it("offline with nothing waiting: no card", () => {
    for (const health of ["offline", "long_offline"] as const) {
      expect(runtimeStuckReason({ health, lastSeenAt: ago(60 * MIN), queue: [], running: 0, now: NOW })).toBeNull();
    }
  });

  it("offline with waiting or running tasks: card", () => {
    for (const health of ["offline", "long_offline"] as const) {
      expect(runtimeStuckReason({ health, lastSeenAt: ago(60 * MIN), queue: queued, running: 1, now: NOW })).toEqual({
        kind: "offline_waiting",
        count: 2,
        lastSeenAt: ago(60 * MIN),
      });
    }
  });

  it("unstable: card even without tasks", () => {
    expect(
      runtimeStuckReason({ health: "recently_lost", lastSeenAt: ago(3 * MIN), queue: [], running: 0, now: NOW }),
    ).toEqual({ kind: "unstable", count: 0, lastSeenAt: ago(3 * MIN) });
  });
});

describe("runtimeStuckText", () => {
  it("offline names the runtime, task count and duration (de)", () => {
    expect(
      runtimeStuckText({ kind: "offline_waiting", count: 3, lastSeenAt: ago(120 * MIN) }, "claude", NOW),
    ).toBe(
      "3 Aufgaben warten auf claude, offline seit 2 Stunden. Sie starten, sobald der Daemon wieder online ist. Prüfe den Rechner bzw. den Dienst „multica daemon“.",
    );
  });

  it("unstable and online variants (en)", async () => {
    await i18n.changeLanguage("en");
    expect(runtimeStuckText({ kind: "unstable", count: 0, lastSeenAt: ago(3 * MIN) }, "x", NOW)).toBe(
      "Runtime unreachable for 3 minutes. Runs continue when it comes back.",
    );
    expect(runtimeStuckText({ kind: "online_waiting", count: 1, oldestAt: ago(5 * MIN) }, "x", NOW)).toBe(
      "1 task waiting for 5 minutes, the runtime is online, possibly at capacity.",
    );
  });
});

describe("queue counts like R2 (without deferred)", () => {
  const agents = [agent("a", "r1"), agent("b", "r1"), agent("c", "r2"), agent("z", "r1", { archived_at: ago(0) })];
  const snapshot = [
    ...ALL_STATUSES.map((s, i) => task("a", s, i + 1, { issue_id: `i-${s}` })),
    task("b", "queued", 90, { issue_id: "i-old" }),
    task("c", "queued", 5),
    task("z", "queued", 5),
  ];

  it("queue holds exactly the R2 statuses, oldest first, linked to the issue", () => {
    const queue = runtimeQueue("r1", agents, snapshot);
    expect(queue.map((q) => q.status).every((s) => RUNTIME_QUEUE_STATUSES.has(s))).toBe(true);
    expect(queue.some((q) => q.status === "deferred")).toBe(false);
    expect(queue.map((q) => q.issue_id)).toEqual(["i-old", "i-waiting_local_directory", "i-dispatched", "i-queued"]);
  });

  it("agent rows count the same tasks as the queue, archived agents left out", () => {
    const rows = runtimeAgentRows("r1", agents, snapshot);
    expect(rows.map((r) => r.agent.id)).toEqual(["a", "b"]);
    const queued = rows.reduce((n, r) => n + r.queuedCount, 0);
    expect(queued).toBe(runtimeQueue("r1", agents, snapshot).length);
    expect(rows[0]).toMatchObject({ runningCount: 1, queuedCount: 3 });
    expect(runtimeAgentWorkText(rows[0]!)).toBe("1 läuft · 3 warten");
    expect(runtimeAgentWorkText({ agent: agents[0]!, runningCount: 0, queuedCount: 0 })).toBe("frei");
  });

  it("queue entry texts: waiting time and local directory hint", () => {
    expect(queueWaitText(task("a", "queued", 40), NOW)).toBe("wartet seit 40 Minuten");
    expect(queueWaitText(task("a", "waiting_local_directory", 40), NOW)).toBe("wartet auf lokales Verzeichnis");
  });
});

describe("activity", () => {
  it("bars: 24 columns, duplicates add up, invalid hours dropped", () => {
    const bars = activityBars([
      { hour: 9, count: 4 },
      { hour: 9, count: 1 },
      { hour: 10, count: 3 },
      { hour: 24, count: 9 },
      { hour: -1, count: 9 },
      { hour: 3, count: -2 },
    ]);
    expect(bars).toHaveLength(24);
    expect(bars[9]).toBe(5);
    expect(bars[10]).toBe(3);
    expect(bars.reduce((a, b) => a + b, 0)).toBe(8);
  });

  it("busiest two-hour window, wrapping past midnight", () => {
    expect(busiestWindow(activityBars([]))).toBeNull();
    expect(busiestWindow(activityBars([{ hour: 23, count: 2 }, { hour: 0, count: 2 }, { hour: 12, count: 3 }]))).toBe(23);
  });

  it("TalkBack summary is one sentence instead of 24 values", async () => {
    const bars = activityBars([
      { hour: 9, count: 5 },
      { hour: 10, count: 3 },
      { hour: 15, count: 1 },
    ]);
    expect(activitySummaryText(bars)).toBe("Meiste Läufe zwischen 9 und 11 Uhr, insgesamt 9 Läufe.");
    expect(activitySummaryText(activityBars([]))).toBe("Noch keine Aktivität.");
    await i18n.changeLanguage("en");
    expect(activitySummaryText(bars)).toBe("Most runs between 9:00 and 11:00, 9 runs in total.");
    await i18n.changeLanguage("zh-Hans");
    expect(activitySummaryText(bars)).toContain("9 点到 11 点");
  });
});

describe("runtimeStatusLine", () => {
  it("online is just the label, offline adds the duration", () => {
    expect(runtimeStatusLine("online", ago(0), NOW)).toBe("Online");
    expect(runtimeStatusLine("offline", ago(120 * MIN), NOW)).toBe("Offline · seit 2 Stunden");
    expect(runtimeStatusLine("offline", null, NOW)).toBe("Offline");
  });
});
