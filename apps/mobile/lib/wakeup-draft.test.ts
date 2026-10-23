import { describe, expect, it } from "vitest";
import {
  atTime,
  buildWakeupInput,
  emptyWakeupDraft,
  endOfDayInZone,
  repeats,
  stepOneError,
  timeZoneChoices,
  wakeableAgents,
  wakeupCreateErrorKind,
  type WakeupCreateDraft,
} from "./wakeup-draft";

// Shape of data/api.ts ApiError without importing react-native.
class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly body?: unknown) {
    super(message);
  }
}

// Local 2026-10-19 10:00 on the test machine.
const NOW = new Date(2026, 9, 19, 10, 0, 0);

function draft(patch: Partial<WakeupCreateDraft>): WakeupCreateDraft {
  return { ...emptyWakeupDraft("agent-1", "Europe/Berlin", NOW), instruction: "  Ergebnis prüfen  ", ...patch };
}

function body(patch: Partial<WakeupCreateDraft>) {
  const r = buildWakeupInput(draft(patch), NOW);
  if ("error" in r) throw new Error(`unexpected error ${r.error}`);
  return r.input;
}

describe("buildWakeupInput – Body je Art", () => {
  it("at: preset in 10 min, once, no deadline fields", () => {
    expect(body({ condition: "at", atPreset: "10m" })).toEqual({
      agent_id: "agent-1",
      instruction: "Ergebnis prüfen",
      kind: "at",
      mode: "once",
      at: new Date(NOW.getTime() + 10 * 60_000).toISOString(),
    });
  });

  it("at: tomorrow is local 09:00, custom takes the picked time", () => {
    expect(body({ condition: "at", atPreset: "tomorrow" }).at).toBe(new Date(2026, 9, 20, 9, 0, 0).toISOString());
    const picked = new Date(2030, 0, 1, 12, 30).toISOString();
    expect(body({ condition: "at", atPreset: "custom", atCustom: picked }).at).toBe(picked);
  });

  it("every: hourly is interval 3600 with zone and end of the until day", () => {
    expect(body({ condition: "recurring", recurrence: "hourly", until: "2026-10-26" })).toEqual({
      agent_id: "agent-1",
      instruction: "Ergebnis prüfen",
      kind: "every",
      interval_seconds: 3600,
      mode: "continuous",
      timezone: "Europe/Berlin",
      expires_at: "2026-10-26T22:59:59.000Z",
    });
  });

  it("every: the until day ends in the chosen zone, not the device's (#128 review)", () => {
    expect(body({ condition: "recurring", until: "2026-10-26", timezone: "Asia/Tokyo" }).expires_at).toBe(
      "2026-10-26T14:59:59.000Z",
    );
    expect(body({ condition: "recurring", until: "2026-10-26", timezone: "America/New_York" }).expires_at).toBe(
      "2026-10-27T03:59:59.000Z",
    );
  });

  it("cron: daily / weekdays presets carry the chosen zone and an optional cap", () => {
    const daily = body({ condition: "recurring", recurrence: "daily", timezone: "Asia/Tokyo" });
    expect(daily).toMatchObject({ kind: "cron", cron_expression: "0 9 * * *", timezone: "Asia/Tokyo", mode: "continuous" });
    expect(daily).not.toHaveProperty("max_fires");
    expect(daily).not.toHaveProperty("interval_seconds");
    const weekdays = body({ condition: "recurring", recurrence: "weekdays", maxFires: 10 });
    expect(weekdays).toMatchObject({ kind: "cron", cron_expression: "0 9 * * 1-5", max_fires: 10 });
  });

  it("event: reply from anyone, once, 7 days then wake", () => {
    expect(body({ condition: "reply" })).toEqual({
      agent_id: "agent-1",
      instruction: "Ergebnis prüfen",
      kind: "event",
      mode: "once",
      event_types: ["comment.created"],
      expires_in_seconds: 7 * 86400,
      on_timeout: "wake",
    });
  });

  it("event: reply from one member, continuous with default cap 20, no deadline", () => {
    const input = body({
      condition: "reply",
      replyActor: { type: "member", id: "m-1" },
      mode: "continuous",
      wait: { kind: "none" },
    });
    expect(input).toEqual({
      agent_id: "agent-1",
      instruction: "Ergebnis prüfen",
      kind: "event",
      mode: "continuous",
      max_fires: 20,
      event_types: ["comment.created"],
      filter_actor_type: "member",
      filter_actor_id: "m-1",
    });
  });

  it("event: run end of one agent, deadline date, end without run", () => {
    expect(
      body({ condition: "run_end", runAgentId: "agent-2", wait: { kind: "date", date: "2026-11-01" }, onTimeout: "end" }),
    ).toEqual({
      agent_id: "agent-1",
      instruction: "Ergebnis prüfen",
      kind: "event",
      mode: "once",
      event_types: ["task.completed", "task.failed", "task.cancelled"],
      filter_agent_id: "agent-2",
      expires_at: new Date(2026, 10, 1, 23, 59, 59).toISOString(),
      on_timeout: "end",
    });
  });

  it("event: any agent's run end has no filter", () => {
    expect(body({ condition: "run_end" })).not.toHaveProperty("filter_agent_id");
  });
});

describe("validation", () => {
  const err = (patch: Partial<WakeupCreateDraft>) => {
    const r = buildWakeupInput(draft(patch), NOW);
    return "error" in r ? r.error : null;
  };

  it("needs a condition, a future time and an end date after today", () => {
    expect(err({ condition: null })).toBe("missing_condition");
    expect(err({ condition: "at", atPreset: "custom", atCustom: null })).toBe("missing_time");
    expect(err({ condition: "at", atPreset: "custom", atCustom: new Date(2026, 9, 19, 9).toISOString() })).toBe("future_time");
    expect(err({ condition: "recurring", until: "2026-10-18" })).toBe("until_future");
    expect(err({ condition: "recurring", until: "kaputt" })).toBe("until_future");
  });

  it("needs an agent and an instruction within 12,000 bytes", () => {
    expect(err({ condition: "at", agentId: "" })).toBe("missing_agent");
    expect(err({ condition: "at", instruction: "   " })).toBe("instruction_empty");
    expect(err({ condition: "at", instruction: "ä".repeat(6001) })).toBe("instruction_too_long");
  });

  it("a deadline date must lie in the future", () => {
    expect(err({ condition: "reply", wait: { kind: "date", date: "2026-10-18" } })).toBe("wait_future");
  });

  it("step 1 alone does not look at agent or instruction", () => {
    expect(stepOneError(draft({ condition: "reply", agentId: "", instruction: "" }), NOW)).toBeNull();
    expect(stepOneError(draft({ condition: null }), NOW)).toBe("missing_condition");
  });

  it("atTime ignores an unreadable custom value", () => {
    expect(atTime({ atPreset: "custom", atCustom: "nope" }, NOW)).toBeNull();
  });
});

describe("helpers", () => {
  it("repeats covers recurring and continuous event rules", () => {
    expect(repeats({ condition: "recurring", mode: "once" })).toBe(true);
    expect(repeats({ condition: "reply", mode: "continuous" })).toBe(true);
    expect(repeats({ condition: "reply", mode: "once" })).toBe(false);
    expect(repeats({ condition: "at", mode: "continuous" })).toBe(false);
  });

  it("timeZoneChoices puts the current and device zone first without duplicates", () => {
    const zones = timeZoneChoices("Asia/Tokyo", "Europe/Berlin");
    expect(zones.slice(0, 2)).toEqual(["Asia/Tokyo", "Europe/Berlin"]);
    expect(new Set(zones).size).toBe(zones.length);
  });

  it("wakeableAgents keeps only runtime-bound, unarchived agents", () => {
    const agents = [
      { id: "a", runtime_id: "rt" },
      { id: "b", runtime_id: "" },
      { id: "c", runtime_id: "rt", runtime_bound: false },
      { id: "d", runtime_id: "rt", archived_at: "2026-01-01" },
    ];
    expect(wakeableAgents(agents).map((a) => a.id)).toEqual(["a"]);
  });
});

describe("wakeupCreateErrorKind – Kapazitätsfehler", () => {
  it("reads the server code and 409/422 as capacity", () => {
    expect(
      wakeupCreateErrorKind(new ApiError("limit", 400, { code: "wakeup_capacity_exceeded", error: "max 32" })),
    ).toBe("capacity");
    expect(wakeupCreateErrorKind(new ApiError("x", 409))).toBe("capacity");
    expect(wakeupCreateErrorKind(new ApiError("x", 422))).toBe("capacity");
  });

  it("tells a closed issue, missing rights and other failures apart", () => {
    expect(wakeupCreateErrorKind(new ApiError("x", 400, { error: "invalid wakeup: issue is closed" }))).toBe("closed");
    expect(wakeupCreateErrorKind(new ApiError("x", 403))).toBe("forbidden");
    expect(wakeupCreateErrorKind(new ApiError("x", 400, { error: "cron invalid" }))).toBe("failed");
    expect(wakeupCreateErrorKind(new Error("network"))).toBe("failed");
    expect(wakeupCreateErrorKind(null)).toBe("failed");
  });
});

describe("endOfDayInZone", () => {
  it("is 23:59:59 wall time in the zone, also across DST switches", () => {
    expect(endOfDayInZone("2026-10-24", "Europe/Berlin").toISOString()).toBe("2026-10-24T21:59:59.000Z");
    expect(endOfDayInZone("2026-10-25", "Europe/Berlin").toISOString()).toBe("2026-10-25T22:59:59.000Z");
    expect(endOfDayInZone("2026-03-29", "Europe/Berlin").toISOString()).toBe("2026-03-29T21:59:59.000Z");
    expect(endOfDayInZone("2026-10-26", "UTC").toISOString()).toBe("2026-10-26T23:59:59.000Z");
  });

  it("falls back to the local day for an unknown zone, invalid for a bad date", () => {
    expect(endOfDayInZone("2026-10-26", "Mars/Olympus").getTime()).toBe(new Date(2026, 9, 26, 23, 59, 59).getTime());
    expect(Number.isFinite(endOfDayInZone("kaputt", "UTC").getTime())).toBe(false);
  });
});
