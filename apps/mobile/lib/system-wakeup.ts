/**
 * System wakeup "Unteraufgaben fertig" (`child_done`) on an issue; web:
 * packages/views/issues/components/system-wakeup-row.tsx.
 *
 * Pure functions over the app i18n singleton (like lib/wakeup-text.ts), so the
 * PUT body and every `blocked` value — also one a newer server adds — are
 * unit-testable without rendering.
 */
import type { MobileSystemWakeup } from "@/data/wakeup-schemas";
import { i18n } from "@/lib/i18n/singleton";
import { wakeupPausedText } from "@/lib/wakeup-text";

const t = (key: string, options?: Record<string, unknown>) =>
  i18n.t(`issues:wakeups.system.${key}`, options ?? {}) as string;

/** The only rule the app knows; others from a newer server are not shown. */
export const SYSTEM_RULE_CHILD_DONE = "child_done";

/** Server limit (service.MaxSystemWakeupInstruction), counted in UTF-8 bytes. */
export const SYSTEM_INSTRUCTION_MAX_BYTES = 4000;

export function knownSystemWakeups(rules: readonly MobileSystemWakeup[]): MobileSystemWakeup[] {
  return rules.filter((r) => r.rule === SYSTEM_RULE_CHILD_DONE);
}

/** Body of `PUT /api/issues/{id}/system-wakeups/{rule}`. Omitted fields keep
 *  their value on the server, so the switch never resends the instruction. */
export function systemWakeupPutBody(patch: { enabled?: boolean; instruction?: string }): {
  enabled?: boolean;
  instruction?: string;
} {
  const body: { enabled?: boolean; instruction?: string } = {};
  if (typeof patch.enabled === "boolean") body.enabled = patch.enabled;
  if (typeof patch.instruction === "string") body.instruction = patch.instruction.trim();
  return body;
}

function utf8Length(s: string): number {
  let n = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0) ?? 0;
    n += c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4;
  }
  return n;
}

export type SystemInstructionCheck =
  | { ok: true; instruction: string }
  | { ok: false; reason: "too_long" | "unchanged" };

/** Empty is allowed here: runs then get `default_instruction`. */
export function checkSystemInstruction(value: string, current: string): SystemInstructionCheck {
  const instruction = value.trim();
  if (utf8Length(instruction) > SYSTEM_INSTRUCTION_MAX_BYTES) return { ok: false, reason: "too_long" };
  if (instruction === current.trim()) return { ok: false, reason: "unchanged" };
  return { ok: true, instruction };
}

/** Why the rule would not start a run now; null when nothing blocks it.
 *  An unknown value from a newer server still gets a neutral hint. */
export function systemWakeupBlockedHint(blocked: string | null | undefined): string | null {
  switch (blocked ?? "") {
    case "":
      return null;
    case "backlog":
      return t("blocked_backlog");
    case "member_assignee":
      return t("blocked_member");
    case "no_assignee":
      return t("blocked_none");
    default:
      return t("blocked_unknown");
  }
}

export function systemWakeupTitle(r: Pick<MobileSystemWakeup, "staged" | "stage">): string {
  return r.staged && r.stage !== null ? t("title_stage", { stage: r.stage }) : t("title_all");
}

/** Who gets woken: an agent/squad is woken, a member only notified. */
export function systemWakeupTargetText(r: Pick<MobileSystemWakeup, "target">): string {
  if (!r.target) return t("target_none");
  return r.target.type === "member"
    ? t("notify_member", { name: r.target.name })
    : t("wake_assignee", { name: r.target.name });
}

/** Second line of the row: pause, off, blocked or "an · 2 von 5 offen · weckt …". */
export function systemWakeupSummary(r: MobileSystemWakeup): string {
  const paused = r.paused_reason
    ? wakeupPausedText({ paused_reason: r.paused_reason, max_fires: null, fire_count: 0 })
    : null;
  if (paused) return paused;
  if (!r.enabled) return t("state_off");
  const parts = [t("state_on")];
  if (r.total > 0) parts.push(t("remaining", { remaining: r.remaining, total: r.total }));
  // A member assignee still gets a notification: show who, plus the hint below.
  const blocked = r.blocked && r.blocked !== "member_assignee" ? systemWakeupBlockedHint(r.blocked) : null;
  parts.push(blocked ?? systemWakeupTargetText(r));
  return parts.join(" · ");
}

/** Hint shown as its own line under the summary: only the member case, the
 *  other `blocked` values are already part of the summary. */
export function systemWakeupExtraHint(r: MobileSystemWakeup): string | null {
  if (!r.enabled || r.paused_reason || r.blocked !== "member_assignee") return null;
  return systemWakeupBlockedHint(r.blocked);
}

export function systemWakeupA11yLabel(r: MobileSystemWakeup): string {
  return [t("badge"), systemWakeupTitle(r), systemWakeupSummary(r), systemWakeupExtraHint(r)]
    .filter(Boolean)
    .join(". ");
}
