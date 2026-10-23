import { describe, expect, it, vi } from "vitest";
import {
  AutopilotDetailSchema,
  AutopilotRunSchema,
  AutopilotSchema,
  AutopilotTriggerSchema,
  type MobileAutopilotTrigger,
} from "@/data/autopilot-schemas";
import de from "@/locales/de/workspace.json";
import {
  deleteThenLeave,
  describeCron,
  formatOfflineFor,
  parseCronSchedule,
  parseWeekdays,
  presenceAgentId,
  runtimeBlocksRuns,
  triggerLines,
} from "./autopilot-detail";
import { autopilotActions, runNowToast } from "./autopilot-list";

/** Minimal i18next-like lookup over the German strings (plurals: _one/_other). */
function t(key: string, opts: Record<string, unknown> = {}): string {
  const path = key.replace(/^workspace:/, "").split(".");
  const node = (k: string[]): unknown =>
    k.reduce<unknown>((o, p) => (o as Record<string, unknown> | undefined)?.[p], de);
  let v = node(path);
  if (v === undefined && typeof opts.count === "number") {
    const last = path[path.length - 1]!;
    v = node([...path.slice(0, -1), `${last}_${opts.count === 1 ? "one" : "other"}`]);
  }
  if (typeof v !== "string") return key;
  return v.replace(/\{\{(\w+)\}\}/g, (_, k: string) => String(opts[k] ?? ""));
}

function trigger(over: Record<string, unknown>): MobileAutopilotTrigger {
  return AutopilotTriggerSchema.parse({ id: "t", kind: "schedule", enabled: true, ...over });
}

describe("parseCronSchedule", () => {
  it.each([
    ["0 2 * * *", { kind: "daily", time: "02:00" }],
    ["30 9 * * 1-5", { kind: "weekly", time: "09:30", days: [1, 2, 3, 4, 5] }],
    ["0 8 * * 0,6", { kind: "weekly", time: "08:00", days: [0, 6] }],
    ["0 8 * * 0-6", { kind: "daily", time: "08:00" }],
    ["15 6 1 * *", { kind: "monthly", time: "06:15", day: 1 }],
    ["*/15 * * * *", { kind: "every_minutes", interval: 15 }],
    ["* * * * *", { kind: "every_minutes", interval: 1 }],
    ["5 */2 * * *", { kind: "every_hours", interval: 2, minute: 5 }],
    ["0 * * * *", { kind: "every_hours", interval: 1, minute: 0 }],
  ])("%s", (expr, expected) => {
    expect(parseCronSchedule(expr)).toEqual(expected);
  });

  it("keeps everything else raw instead of guessing", () => {
    for (const expr of ["0 2 * 1 *", "0 9-17 * * *", "0 2 1 * 1", "TZ=Europe/Berlin 0 2 * * *", "@daily", "61 2 * * *"]) {
      expect(parseCronSchedule(expr)).toEqual({ kind: "raw", expr });
    }
    expect(parseCronSchedule("")).toBeNull();
    expect(parseCronSchedule(null)).toBeNull();
  });

  it("reads Sunday as 0 or 7", () => {
    expect(parseWeekdays("7")).toEqual([0]);
    expect(parseWeekdays("5-7")).toEqual([0, 5, 6]);
    expect(parseWeekdays("6-2")).toBeNull();
  });
});

describe("describeCron", () => {
  const d = (expr: string) => describeCron(parseCronSchedule(expr)!, t);
  it("reads back as plain German", () => {
    expect(d("0 2 * * *")).toBe("täglich 02:00");
    expect(d("30 9 * * 1-5")).toBe("Mo–Fr 09:30");
    expect(d("0 8 * * 0,6")).toBe("So, Sa 08:00");
    expect(d("0 8 * * 1,2")).toBe("Mo, Di 08:00");
    expect(d("15 6 1 * *")).toBe("monatlich am 1. um 06:15");
    expect(d("*/15 * * * *")).toBe("alle 15 Min");
    expect(d("5 */2 * * *")).toBe("alle 2 Std zur Minute 05");
    expect(d("0 9-17 * * *")).toBe("Cron 0 9-17 * * *");
  });
});

describe("triggerLines", () => {
  it("shows a schedule with cron text, time zone and next run", () => {
    const [line] = triggerLines(
      [trigger({ cron_expression: "0 2 * * *", timezone: "Europe/Berlin", next_run_at: "2026-10-19T00:00:00Z" })],
      t,
    );
    expect(line).toMatchObject({
      kindLabel: "Zeitplan",
      schedule: "täglich 02:00",
      timezone: "Europe/Berlin",
      nextRunAt: "2026-10-19T00:00:00Z",
    });
  });

  it("drops the next run of a disabled schedule", () => {
    const [line] = triggerLines([trigger({ cron_expression: "0 2 * * *", enabled: false, next_run_at: "x" })], t);
    expect(line).toMatchObject({ enabled: false, nextRunAt: null });
  });

  it("never carries the webhook URL, token or path", () => {
    const secret = "https://multica.example/api/webhooks/autopilot/sekret-token-123";
    const lines = triggerLines(
      [
        trigger({
          kind: "webhook",
          webhook_url: secret,
          webhook_token: "sekret-token-123",
          webhook_path: "/api/webhooks/autopilot/sekret-token-123",
        }),
      ],
      t,
    );
    expect(lines[0]).toMatchObject({ kindLabel: "Webhook", schedule: null, timezone: null });
    expect(JSON.stringify(lines)).not.toContain("sekret");
    // The detail answer itself is cleaned already (A1 schema).
    const detail = AutopilotDetailSchema.parse({
      autopilot: { id: "a", title: "A", status: "active" },
      triggers: [{ id: "w", kind: "webhook", webhook_url: secret, webhook_token: "sekret-token-123" }],
    });
    expect(JSON.stringify(detail)).not.toContain("sekret");
  });

  it("shows an unknown kind as its raw value", () => {
    expect(triggerLines([trigger({ kind: "github" })], t)[0]?.kindLabel).toBe("github");
  });
});

describe("assignee runtime", () => {
  const squads = [{ id: "s1", leader_id: "lead" }];
  it("uses the agent, or the squad leader", () => {
    const a = AutopilotSchema.parse({ id: "a", title: "A", assignee_type: "agent", assignee_id: "ag" });
    const s = AutopilotSchema.parse({ id: "b", title: "B", assignee_type: "squad", assignee_id: "s1" });
    const x = AutopilotSchema.parse({ id: "c", title: "C", assignee_type: "team", assignee_id: "s1" });
    expect(presenceAgentId(a, squads)).toBe("ag");
    expect(presenceAgentId(s, squads)).toBe("lead");
    expect(presenceAgentId(s, [])).toBeNull();
    expect(presenceAgentId(x, squads)).toBeNull();
  });

  it("warns that scheduled runs are skipped only when the runtime is gone", () => {
    expect(runtimeBlocksRuns("stuck_offline")).toBe(true);
    expect(runtimeBlocksRuns("unavailable")).toBe(true);
    expect(runtimeBlocksRuns("no_runtime")).toBe(true);
    for (const k of ["working", "queued", "idle", "connection_lost", "archived"] as const) {
      expect(runtimeBlocksRuns(k)).toBe(false);
    }
    expect(runtimeBlocksRuns(null)).toBe(false);
  });

  it("formats the offline duration", () => {
    expect(formatOfflineFor(10_000, t)).toBe("1 Min");
    expect(formatOfflineFor(40 * 60_000, t)).toBe("40 Min");
    expect(formatOfflineFor(3 * 3_600_000, t)).toBe("3 Std");
    expect(formatOfflineFor(3 * 86_400_000, t)).toBe("3 Tagen");
  });
});

describe("run now from the detail (shared with A2)", () => {
  const run = (over: Record<string, unknown>) =>
    AutopilotRunSchema.parse({ id: "r", status: "running", source: "manual", ...over });

  it.each([
    ["issue_created", "success", "issue_created", "open_issue"],
    ["running", "success", "running", null],
    ["completed", "success", "completed", null],
    ["skipped", "warning", "skipped", null],
    ["failed", "error", "failed", null],
    ["teleported", "neutral", "unknown", null],
  ] as const)("%s → %s toast", (status, tone, key, action) => {
    const toast = runNowToast(run({ status, issue_id: "i1", reason_code: "runtime_offline", failure_reason: "boom" }));
    expect(toast).toMatchObject({ tone, key, action });
    expect(t(`autopilot.run_toast.${toast.key}`, { ...toast.params, reason: "x" })).not.toMatch(/^autopilot\./);
  });

  it("offers no actions without write access", () => {
    expect(autopilotActions({ status: "active", can_write: false }).filter((x) => x !== "runs")).toEqual([]);
    expect(autopilotActions({ status: "active", can_write: true })).toEqual(["run", "pause", "runs", "delete"]);
  });
});

describe("deleteThenLeave", () => {
  it("leaves only after the server confirmed", async () => {
    let resolve!: () => void;
    const pending = new Promise<void>((r) => (resolve = r));
    const leave = vi.fn();
    const failed = vi.fn();
    const done = deleteThenLeave(() => pending, leave, failed);
    await Promise.resolve();
    expect(leave).not.toHaveBeenCalled();
    resolve();
    await expect(done).resolves.toBe(true);
    expect(leave).toHaveBeenCalledTimes(1);
    expect(failed).not.toHaveBeenCalled();
  });

  it("stays on the detail when the delete fails", async () => {
    const leave = vi.fn();
    const failed = vi.fn();
    await expect(deleteThenLeave(() => Promise.reject(new Error("403")), leave, failed)).resolves.toBe(false);
    expect(leave).not.toHaveBeenCalled();
    expect(failed).toHaveBeenCalledTimes(1);
  });
});
