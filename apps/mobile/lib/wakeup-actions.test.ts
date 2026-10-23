import { describe, expect, it } from "vitest";
import {
  canManageWakeup,
  checkWakeupInstruction,
  enableNeedsNewTime,
  instructionLines,
  instructionPatch,
  isFutureTime,
  rescheduleAt,
  snapshotAfterConflict,
  wakeupActions,
  wakeupErrorKind,
  wakeupSwitchState,
  WAKEUP_INSTRUCTION_MAX_BYTES,
} from "./wakeup-actions";

const NOW = Date.parse("2026-10-18T06:00:00Z");

const row = (over: Record<string, unknown> = {}) => ({
  kind: "at" as const,
  enabled: true,
  next_fire_at: "2026-10-18T09:00:00Z",
  disabled_at: null,
  paused_reason: null,
  ...over,
});

const open = { closed: false, canManage: true };

describe("canManageWakeup", () => {
  it("allows when the row says nothing (issue list has no can_manage)", () => {
    expect(canManageWakeup(row())).toBe(true);
  });
  it("denies on can_manage === false or after a 403", () => {
    expect(canManageWakeup(row({ can_manage: false }))).toBe(false);
    expect(canManageWakeup(row({ can_manage: true }), true)).toBe(false);
  });
});

describe("wakeupActions", () => {
  it("enabled rule: trigger, edit, view runs, disable, delete in spec order", () => {
    expect(wakeupActions(row(), open)).toEqual(["trigger", "edit_instruction", "view_runs", "disable", "delete"]);
  });
  it("disabled rule: enable instead of disable, no trigger once disabled_at is set", () => {
    expect(wakeupActions(row({ enabled: false, disabled_at: "2026-10-18T05:00:00Z" }), open)).toEqual([
      "edit_instruction",
      "view_runs",
      "enable",
      "delete",
    ]);
  });
  it("paused by the system: resume, no trigger, no switch", () => {
    const w = row({ paused_reason: "loop" });
    expect(wakeupActions(w, open)).toEqual(["edit_instruction", "view_runs", "resume", "delete"]);
    expect(wakeupSwitchState(w, open)).toBe("hidden");
  });
  it("no rights: only view runs (read-only, W6) and no switch", () => {
    const opts = { closed: false, canManage: false };
    expect(wakeupActions(row(), opts)).toEqual(["view_runs"]);
    expect(wakeupSwitchState(row(), opts)).toBe("hidden");
  });
  it("closed issue: can still switch off/delete, not trigger or re-enable", () => {
    const opts = { closed: true, canManage: true };
    expect(wakeupActions(row(), opts)).toEqual(["edit_instruction", "view_runs", "disable", "delete"]);
    expect(wakeupActions(row({ enabled: false }), opts)).toEqual(["edit_instruction", "view_runs", "delete"]);
    expect(wakeupSwitchState(row({ enabled: false }), opts)).toBe("off_locked");
    expect(wakeupActions(row({ paused_reason: "rate" }), opts)).toEqual(["edit_instruction", "view_runs", "delete"]);
  });
  it("switch state follows enabled", () => {
    expect(wakeupSwitchState(row(), open)).toBe("on");
    expect(wakeupSwitchState(row({ enabled: false }), open)).toBe("off");
  });
});

describe("enableNeedsNewTime", () => {
  it("only for at rules whose time has passed or is missing", () => {
    expect(enableNeedsNewTime(row(), NOW)).toBe(false);
    expect(enableNeedsNewTime(row({ next_fire_at: "2026-10-18T05:59:00Z" }), NOW)).toBe(true);
    expect(enableNeedsNewTime(row({ next_fire_at: null }), NOW)).toBe(true);
    expect(enableNeedsNewTime(row({ next_fire_at: "garbage" }), NOW)).toBe(true);
    expect(enableNeedsNewTime(row({ kind: "every", next_fire_at: null }), NOW)).toBe(false);
    expect(enableNeedsNewTime(row({ kind: "event", next_fire_at: null }), NOW)).toBe(false);
  });
});

describe("rescheduleAt / isFutureTime", () => {
  const now = new Date(2026, 9, 18, 23, 30); // local time
  it("presets", () => {
    expect(Date.parse(rescheduleAt("in_10m", now)) - now.getTime()).toBe(10 * 60_000);
    expect(Date.parse(rescheduleAt("in_1h", now)) - now.getTime()).toBe(60 * 60_000);
    const t9 = new Date(rescheduleAt("tomorrow_9", now));
    expect([t9.getFullYear(), t9.getMonth(), t9.getDate(), t9.getHours(), t9.getMinutes()]).toEqual([
      2026, 9, 19, 9, 0,
    ]);
  });
  it("tomorrow 09:00 rolls over the month end", () => {
    const t9 = new Date(rescheduleAt("tomorrow_9", new Date(2026, 9, 31, 8, 0)));
    expect([t9.getMonth(), t9.getDate()]).toEqual([10, 1]);
  });
  it("every preset lies in the future", () => {
    for (const p of ["in_10m", "in_1h", "tomorrow_9"] as const) {
      expect(isFutureTime(new Date(rescheduleAt(p, now)), now.getTime())).toBe(true);
    }
    expect(isFutureTime(new Date(now.getTime() - 1), now.getTime())).toBe(false);
    expect(isFutureTime(new Date("nope"), now.getTime())).toBe(false);
  });
});

describe("checkWakeupInstruction", () => {
  it("trims, rejects empty/unchanged/too long", () => {
    expect(checkWakeupInstruction("  neu  ", "alt")).toEqual({ ok: true, instruction: "neu" });
    expect(checkWakeupInstruction("   ", "alt")).toEqual({ ok: false, reason: "empty" });
    expect(checkWakeupInstruction("alt ", "alt")).toEqual({ ok: false, reason: "unchanged" });
    // Byte limit, not characters: 4001 × "ä" (2 bytes) = 8002 ok, 6001 × = 12002 too long.
    expect(checkWakeupInstruction("ä".repeat(4001), "").ok).toBe(true);
    expect(checkWakeupInstruction("ä".repeat(WAKEUP_INSTRUCTION_MAX_BYTES / 2 + 1), "")).toEqual({
      ok: false,
      reason: "too_long",
    });
    expect(checkWakeupInstruction("😀".repeat(3001), "")).toEqual({ ok: false, reason: "too_long" });
  });
});

describe("409 flow", () => {
  const snapshot = { id: "w1", instruction: "alt", revision: 3 };
  it("patch body carries the snapshot's instruction and revision", () => {
    expect(instructionPatch(snapshot, "neu")).toEqual({ instruction: "neu", expected_instruction: "alt", revision: 3 });
    expect(instructionPatch({ instruction: "", revision: undefined }, "x").revision).toBe(0);
  });
  it("classifies server errors", () => {
    expect(wakeupErrorKind({ status: 409 })).toBe("conflict");
    expect(wakeupErrorKind({ status: 403 })).toBe("forbidden");
    expect(wakeupErrorKind({ status: 404 })).toBe("gone");
    expect(wakeupErrorKind({ status: 500 })).toBe("failed");
    expect(wakeupErrorKind(new Error("network"))).toBe("failed");
    expect(wakeupErrorKind(null)).toBe("failed");
  });
  it("after a 409 the fresh row becomes the snapshot, so the retry sends the new revision", () => {
    const fresh = [
      { id: "w0", instruction: "x", revision: 1 },
      { id: "w1", instruction: "von anderer Person", revision: 4 },
    ];
    const next = snapshotAfterConflict(fresh, "w1");
    expect(next).toEqual(fresh[1]);
    expect(instructionPatch(next!, "neu")).toEqual({
      instruction: "neu",
      expected_instruction: "von anderer Person",
      revision: 4,
    });
  });
  it("rule deleted meanwhile → null", () => {
    expect(snapshotAfterConflict([{ id: "w0" }], "w1")).toBeNull();
    expect(snapshotAfterConflict(undefined, "w1")).toBeNull();
  });
});

describe("instructionLines", () => {
  it("2 lines, 3 at 200 % font", () => {
    expect(instructionLines(1)).toBe(2);
    expect(instructionLines(1.5)).toBe(2);
    expect(instructionLines(2)).toBe(3);
  });
});
