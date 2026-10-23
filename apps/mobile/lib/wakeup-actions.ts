/**
 * Action logic for one wakeup row in the issue detail.
 * Pure functions, so the menu, the TalkBack actions and the switch all use
 * the same rules.
 *
 * Rights: the issue list has no `can_manage` (only the workspace overview
 * has it, `WorkspaceWakeup`). The server allows the creator and workspace
 * owners/admins (service/issue_wakeup.go). So a row shows actions unless it
 * says `can_manage === false` or the server already answered 403 for it.
 */
import type { MobileIssueWakeup } from "@/data/wakeup-schemas";

export type WakeupAction =
  | "trigger"
  | "edit_instruction"
  | "view_runs"
  | "enable"
  | "disable"
  | "resume"
  | "delete";

type Row = Pick<
  MobileIssueWakeup,
  "kind" | "enabled" | "next_fire_at" | "disabled_at" | "paused_reason"
> & { can_manage?: unknown };

/** False only when the row or a 403 says so; see the file comment. */
export function canManageWakeup(w: Row, forbidden = false): boolean {
  return !forbidden && w.can_manage !== false;
}

/** Enabling an `at` rule whose time has passed needs a new time first. */
export function enableNeedsNewTime(w: Row, now: number = Date.now()): boolean {
  if (w.kind !== "at") return false;
  if (!w.next_fire_at) return true;
  const t = new Date(w.next_fire_at).getTime();
  return !Number.isFinite(t) || t <= now;
}

/**
 * Menu / TalkBack actions in spec order: trigger · edit instruction · view
 * runs · on/off (or resume when the system paused it) · delete. Without
 * rights: only "view runs" (W6, read-only). A closed issue cannot be
 * re-armed or triggered, but its rules can still be switched off, edited
 * and deleted.
 */
export function wakeupActions(
  w: Row,
  opts: { closed: boolean; canManage: boolean },
): WakeupAction[] {
  if (!opts.canManage) return ["view_runs"];
  const out: WakeupAction[] = [];
  if (!opts.closed && !w.disabled_at && !w.paused_reason) out.push("trigger");
  out.push("edit_instruction", "view_runs");
  if (w.paused_reason) {
    if (!opts.closed) out.push("resume");
  } else if (w.enabled) {
    out.push("disable");
  } else if (!opts.closed) {
    out.push("enable");
  }
  out.push("delete");
  return out;
}

/** The switch is shown for a rule with rights and not paused by the system
 *  (that one gets the "Resume" button instead). Off + closed issue: the
 *  switch is there but disabled. */
export function wakeupSwitchState(
  w: Row,
  opts: { closed: boolean; canManage: boolean },
): "hidden" | "on" | "off" | "off_locked" {
  if (!opts.canManage || w.paused_reason) return "hidden";
  if (w.enabled) return "on";
  return opts.closed ? "off_locked" : "off";
}

export type ReschedulePreset = "in_10m" | "in_1h" | "tomorrow_9";
export const RESCHEDULE_PRESETS: ReschedulePreset[] = ["in_10m", "in_1h", "tomorrow_9"];

/** New `at` for a preset, in device time ("Morgen 09:00" = local 09:00). */
export function rescheduleAt(preset: ReschedulePreset, now: Date = new Date()): string {
  switch (preset) {
    case "in_10m":
      return new Date(now.getTime() + 10 * 60_000).toISOString();
    case "in_1h":
      return new Date(now.getTime() + 60 * 60_000).toISOString();
    case "tomorrow_9": {
      const d = new Date(now);
      d.setDate(d.getDate() + 1);
      d.setHours(9, 0, 0, 0);
      return d.toISOString();
    }
  }
}

/** Picked time must lie in the future (server rejects a past `at`). */
export function isFutureTime(value: Date, now: number = Date.now()): boolean {
  return Number.isFinite(value.getTime()) && value.getTime() > now;
}

/** Server limit for an instruction (UTF-8 bytes, like web). */
export const WAKEUP_INSTRUCTION_MAX_BYTES = 12000;

function utf8Length(s: string): number {
  let n = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0) ?? 0;
    n += c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4;
  }
  return n;
}

export type InstructionCheck =
  | { ok: true; instruction: string }
  | { ok: false; reason: "empty" | "too_long" | "unchanged" };

export function checkWakeupInstruction(value: string, original: string): InstructionCheck {
  const instruction = value.trim();
  if (!instruction) return { ok: false, reason: "empty" };
  if (utf8Length(instruction) > WAKEUP_INSTRUCTION_MAX_BYTES) return { ok: false, reason: "too_long" };
  if (instruction === original.trim()) return { ok: false, reason: "unchanged" };
  return { ok: true, instruction };
}

export type WakeupErrorKind = "conflict" | "forbidden" | "gone" | "failed";

/** 409 = changed meanwhile (reload), 403 = no rights (hide actions),
 *  404 = rule is gone (reload), everything else = generic failure. */
export function wakeupErrorKind(err: unknown): WakeupErrorKind {
  // Duck-typed ApiError (data/api.ts) so this file stays free of the client.
  const status = (err as { status?: unknown } | null)?.status;
  if (typeof status !== "number") return "failed";
  if (status === 409) return "conflict";
  if (status === 403) return "forbidden";
  if (status === 404) return "gone";
  return "failed";
}

/**
 * Body for PATCH …/instruction. `expected_instruction` and `revision` come
 * from the snapshot the sheet opened with, not from a later refetch, so a
 * concurrent edit conflicts (409) instead of being overwritten.
 */
export function instructionPatch(
  snapshot: Pick<MobileIssueWakeup, "instruction" | "revision">,
  instruction: string,
): { instruction: string; expected_instruction: string; revision: number } {
  return { instruction, expected_instruction: snapshot.instruction, revision: snapshot.revision ?? 0 };
}

/**
 * After a 409 the sheet reloads: the fresh server row becomes the new
 * snapshot (so the next save can succeed), the user's draft stays. If the
 * rule vanished meanwhile, `null` → the sheet says so and closes.
 */
export function snapshotAfterConflict<T extends { id: string }>(fresh: T[] | undefined, wakeupId: string): T | null {
  return fresh?.find((w) => w.id === wakeupId) ?? null;
}

/** Instruction lines in the row: 2, at large font (≥ 200 %) 3. */
export function instructionLines(fontScale: number): number {
  return fontScale >= 2 ? 3 : 2;
}
