// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { MobileIssueWakeup, MobileIssueWakeupSummaryRow } from "@/data/wakeup-schemas";
import { IssueWakeupListSchema } from "@/data/wakeup-schemas";
import { i18n } from "./i18n/singleton";
import { BUILT_IN_STATUS_ORDER, statusCategoryOfKey } from "./issue-status";
import {
  formatRelativeIn,
  isOverdue,
  isWakeupEnded,
  showWakeupClosedHint,
  splitWakeups,
  wakeupChip,
  wakeupDeadlineText,
  wakeupIcon,
  wakeupMetaText,
  wakeupPausedText,
  wakeupRowA11yLabel,
  wakeupSectionAutoOpen,
  wakeupSectionState,
  wakeupSourceText,
  wakeupTriggerText,
} from "./wakeup-text";

// Fixed "now": Sat 2026-10-17 12:00 local time.
const NOW = new Date(2026, 9, 17, 12, 0, 0);

function rule(over: Partial<MobileIssueWakeup> = {}): MobileIssueWakeup {
  // Go through the real schema so defaults match what the API layer yields.
  const [parsed] = IssueWakeupListSchema.parse([
    { id: "w-1", issue_id: "i-1", agent_name: "planner", kind: "at", enabled: true },
  ]);
  return { ...parsed!, ...over };
}

describe("wakeup-text", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("de");
  });
  afterEach(async () => {
    await i18n.changeLanguage("en");
  });

  describe("trigger text per kind", () => {
    it("at: tomorrow with clock time", () => {
      const at = new Date(2026, 9, 18, 9, 0).toISOString();
      expect(wakeupTriggerText(rule({ kind: "at", next_fire_at: at }), {}, NOW)).toBe("Morgen 09:00");
    });

    it("at without a time", () => {
      expect(wakeupTriggerText(rule({ kind: "at", next_fire_at: null }), {}, NOW)).toBe("Zur geplanten Zeit");
    });

    it("every: hourly, hours, minutes, seconds", () => {
      const every = (s: number) => wakeupTriggerText(rule({ kind: "every", interval_seconds: s }), {}, NOW);
      expect(every(3600)).toBe("Stündlich");
      expect(every(7200)).toBe("Alle 2 Stunden");
      expect(every(600)).toBe("Alle 10 Min");
      expect(every(45)).toBe("Alle 45 Sekunden");
    });

    it("cron: expression and zone", () => {
      expect(
        wakeupTriggerText(rule({ kind: "cron", cron_expression: "0 9 * * 1", timezone: "Europe/Berlin" }), {}, NOW),
      ).toBe("Zeitplan 0 9 * * 1 · Europe/Berlin");
    });

    it("event: known event, actor filter and extra events", () => {
      expect(wakeupTriggerText(rule({ kind: "event", event_types: ["comment.created"] }), {}, NOW)).toBe(
        "Bei neuem Kommentar",
      );
      expect(
        wakeupTriggerText(
          rule({
            kind: "event",
            event_types: ["comment.created", "issue.status_changed"],
            filter_actor_type: "member",
            filter_actor_name: "admin",
          }),
          {},
          NOW,
        ),
      ).toBe("Bei neuem Kommentar (durch admin) +1");
      expect(
        wakeupTriggerText(rule({ kind: "event", event_types: ["task.completed"], filter_agent_name: "coder" }), {}, NOW),
      ).toBe("Wenn coder einen Lauf erfolgreich beendet");
    });

    it("event: unknown event type names the raw event", () => {
      expect(wakeupTriggerText(rule({ kind: "event", event_types: ["thing.new"] }), {}, NOW)).toBe(
        "Bei Ereignis thing.new",
      );
    });

    it("unknown kind does not crash", () => {
      expect(wakeupTriggerText(rule({ kind: "unknown" }), {}, NOW)).toBe("Wakeup unbekannter Art");
    });

    it("condition wins over kind: status, other issue, children, PR", () => {
      const cond = (c: MobileIssueWakeup["condition"]) =>
        wakeupTriggerText(rule({ kind: "event", condition: c }), { status: (k) => k }, NOW);
      expect(cond({ type: "issue_field", field: "status", value: "in_review" })).toBe("Status → in_review");
      expect(cond({ type: "other_issue", issue_id: "x", state: "in_review", identifier: "MUL-238" })).toBe(
        "Status → in_review (MUL-238)",
      );
      expect(cond({ type: "children_done", stage: 2 })).toBe("Wenn die Unteraufgaben von Stufe 2 fertig sind");
      expect(cond({ type: "pull_request", event: "merged" })).toBe("Wenn der verknüpfte PR gemergt ist");
      expect(
        cond({ type: "issue_field", field: "assignee", assignee_type: "agent", assignee_id: "a" }),
      ).toBe("Wenn jemand zuständig wird");
    });
  });

  it("icon per kind", () => {
    expect(wakeupIcon({ kind: "at", condition: null })).toBe("time");
    expect(wakeupIcon({ kind: "cron", condition: null })).toBe("recurring");
    expect(wakeupIcon({ kind: "event", condition: null })).toBe("event");
    expect(wakeupIcon({ kind: "unknown", condition: null })).toBe("unknown");
    expect(wakeupIcon({ kind: "at", condition: { type: "children_done" } })).toBe("event");
  });

  it("source: member vs agent", () => {
    expect(wakeupSourceText(rule({ created_by_name: "admin" }))).toBe("von admin");
    expect(
      wakeupSourceText(rule({ created_by_agent: true, source_agent_name: "planner", created_by_name: "admin" })),
    ).toBe("von planner (Agent)");
    expect(wakeupSourceText(rule({ created_by_name: null }))).toBeNull();
  });

  it("deadline with on_timeout and timed out", () => {
    const exp = new Date(2026, 9, 18, 8, 0).toISOString();
    expect(wakeupDeadlineText(rule({ expires_at: exp, on_timeout: "wake" }), NOW)).toBe(
      "bis Morgen 08:00, dann wecken",
    );
    expect(wakeupDeadlineText(rule({ expires_at: exp, on_timeout: "end" }), NOW)).toBe(
      "bis Morgen 08:00, dann beenden",
    );
    expect(wakeupDeadlineText(rule({ expires_at: null }), NOW)).toBeNull();
    expect(wakeupDeadlineText(rule({ timed_out_at: new Date(2026, 9, 17, 9, 5).toISOString() }), NOW)).toBe(
      "abgelaufen Heute 09:05",
    );
  });

  it("paused banner per reason, unknown included", () => {
    expect(wakeupPausedText(rule({ paused_reason: "loop" }))).toBe("Vom System pausiert: Schleife erkannt");
    expect(wakeupPausedText(rule({ paused_reason: "max_fires", max_fires: 5 }))).toBe(
      "Vom System pausiert: Höchstzahl von 5 Läufen erreicht",
    );
    expect(wakeupPausedText(rule({ paused_reason: "rate" }))).toBe(
      "Vom System pausiert: zu viele Läufe in kurzer Zeit",
    );
    expect(wakeupPausedText(rule({ paused_reason: "unknown" }))).toBe("Vom System pausiert: Grund unbekannt");
    expect(wakeupPausedText(rule({ paused_reason: null }))).toBeNull();
  });

  it("ended: timed out or fired once; paused/disabled stay current", () => {
    expect(isWakeupEnded(rule({ enabled: false, timed_out_at: "2026-10-17T09:00:00Z" }))).toBe(true);
    expect(isWakeupEnded(rule({ enabled: false, mode: "once", last_task_id: "t-1" }))).toBe(true);
    expect(isWakeupEnded(rule({ enabled: false, paused_reason: "loop", timed_out_at: "x" }))).toBe(false);
    expect(isWakeupEnded(rule({ enabled: false, disabled_at: "x", mode: "once", last_task_id: "t" }))).toBe(false);
    expect(isWakeupEnded(rule({ enabled: true, last_task_id: "t" }))).toBe(false);
    const { current, ended } = splitWakeups([
      rule({ id: "a" }),
      rule({ id: "b", enabled: false, timed_out_at: "x" }),
    ]);
    expect(current.map((r) => r.id)).toEqual(["a"]);
    expect(ended.map((r) => r.id)).toEqual(["b"]);
  });

  it("row TalkBack label as in spec §1.2", () => {
    const at = new Date(2026, 9, 18, 9, 0).toISOString();
    expect(
      wakeupRowA11yLabel(
        rule({ next_fire_at: at, created_by_name: "admin", instruction: "Ergebnis prüfen und weitermachen" }),
        {},
        NOW,
      ),
    ).toBe(
      "Wakeup: Morgen 09:00, weckt planner, eingeschaltet, von admin. Anweisung: Ergebnis prüfen und weitermachen",
    );
    expect(wakeupRowA11yLabel(rule({ next_fire_at: at, paused_reason: "loop", enabled: false }), {}, NOW)).toBe(
      "Wakeup: Morgen 09:00, weckt planner, pausiert. Vom System pausiert: Schleife erkannt.",
    );
  });

  it("meta line: deadline · source · last run", () => {
    expect(
      wakeupMetaText(rule({ created_by_name: "admin", last_task_status: "completed" }), NOW),
    ).toBe("von admin · Lauf erfolgreich");
    expect(wakeupMetaText(rule({ last_task_status: "brand_new" }), NOW)).toBe("brand_new");
  });

  it("relative time", () => {
    const n = NOW.getTime();
    expect(formatRelativeIn(new Date(n + 10 * 60_000).toISOString(), n)).toBe("in 10 Min");
    expect(formatRelativeIn(new Date(n + 3 * 3600_000).toISOString(), n)).toBe("in 3 Std");
    expect(formatRelativeIn(new Date(n + 2 * 86400_000).toISOString(), n)).toBe("in 2 Tagen");
    expect(formatRelativeIn(new Date(n - 1000).toISOString(), n)).toBe("jetzt");
    expect(formatRelativeIn(new Date(n + 30_000).toISOString(), n)).toBe("jetzt");
    expect(formatRelativeIn("nope", n)).toBeNull();
  });

  describe("header chip", () => {
    const row = (over: Partial<MobileIssueWakeupSummaryRow>) =>
      ({ issue_id: "i-1", active_count: 2, next_fire_at: null, ...over }) as MobileIssueWakeupSummaryRow;

    it("only with active wakeups", () => {
      expect(wakeupChip(undefined, "i-1")).toBeNull();
      expect(wakeupChip([row({ active_count: 0 })], "i-1")).toBeNull();
      expect(wakeupChip([row({ issue_id: "other" })], "i-1")).toBeNull();
    });

    it("label and TalkBack with next time", () => {
      const n = NOW.getTime();
      const chip = wakeupChip([row({ next_fire_at: new Date(n + 3 * 3600_000).toISOString() })], "i-1", n);
      expect(chip).toEqual({
        label: "2 · in 3 Std",
        a11y: "2 aktive Wakeups, nächster in 3 Std. Doppeltippen zum Anzeigen.",
      });
      expect(wakeupChip([row({ active_count: 1 })], "i-1", n)).toEqual({
        label: "1",
        a11y: "1 aktiver Wakeup. Doppeltippen zum Anzeigen.",
      });
    });
  });

  describe("overdue instead of now", () => {
    const n = NOW.getTime();
    const past = (ms: number) => new Date(n - ms).toISOString();

    it("a time more than a minute past reads overdue", () => {
      expect(isOverdue(past(61_000), n)).toBe(true);
      expect(isOverdue(past(30_000), n)).toBe(false);
      expect(isOverdue(new Date(n + 60_000).toISOString(), n)).toBe(false);
      expect(isOverdue("nope", n)).toBe(false);
      expect(formatRelativeIn(past(10 * 60_000), n)).toBe("überfällig");
      expect(formatRelativeIn(past(3 * 86400_000), n)).toBe("überfällig");
    });

    it("chip label and TalkBack say overdue, not now", () => {
      const rows = (count: number) =>
        [{ issue_id: "i-1", active_count: count, next_fire_at: past(5 * 60_000) }] as MobileIssueWakeupSummaryRow[];
      expect(wakeupChip(rows(7), "i-1", n)).toEqual({
        label: "7 · überfällig",
        a11y: "7 aktive Wakeups, nächster überfällig. Doppeltippen zum Anzeigen.",
      });
      expect(wakeupChip(rows(1), "i-1", n)?.a11y).toBe("1 aktiver Wakeup, überfällig. Doppeltippen zum Anzeigen.");
    });

    it("English and Chinese overdue strings", async () => {
      const rows = [{ issue_id: "i-1", active_count: 2, next_fire_at: past(5 * 60_000) }] as MobileIssueWakeupSummaryRow[];
      await i18n.changeLanguage("en");
      expect(wakeupChip(rows, "i-1", n)).toEqual({
        label: "2 · overdue",
        a11y: "2 active wakeups, next one overdue. Double-tap to show.",
      });
      await i18n.changeLanguage("zh-Hans");
      expect(wakeupChip(rows, "i-1", n)).toEqual({
        label: "2 · 已逾期",
        a11y: "2 个活动唤醒，下次已逾期。双击查看。",
      });
    });
  });

  describe("section order", () => {
    const at = (h: number) => new Date(2026, 9, 17, h, 0).toISOString();

    it("active first by next due time, then paused, then off; ended last, newest first", () => {
      // Server order: old → new.
      const { current, ended } = splitWakeups([
        rule({ id: "off", enabled: false }),
        rule({ id: "ended-old", enabled: false, timed_out_at: at(8) }),
        rule({ id: "on-late", next_fire_at: at(18) }),
        rule({ id: "paused", enabled: false, paused_reason: "loop" }),
        rule({ id: "on-no-time", next_fire_at: null }),
        rule({ id: "on-deadline", next_fire_at: null, expires_at: at(14) }),
        rule({ id: "on-overdue", next_fire_at: at(9) }),
        rule({ id: "ended-new", enabled: false, timed_out_at: at(10) }),
        rule({ id: "on-soon", next_fire_at: at(13) }),
      ]);
      expect(current.map((r) => r.id)).toEqual([
        "on-overdue",
        "on-soon",
        "on-deadline",
        "on-late",
        "on-no-time",
        "paused",
        "off",
      ]);
      expect(ended.map((r) => r.id)).toEqual(["ended-new", "ended-old"]);
    });

    it("ties keep the server order and the input is not mutated", () => {
      const input = [rule({ id: "a", next_fire_at: at(13) }), rule({ id: "b", next_fire_at: at(13) })];
      expect(splitWakeups(input).current.map((r) => r.id)).toEqual(["a", "b"]);
      expect(input.map((r) => r.id)).toEqual(["a", "b"]);
    });
  });

  it("closed hint only for done/cancelled issues", () => {
    expect(showWakeupClosedHint("done")).toBe(true);
    expect(showWakeupClosedHint("closed")).toBe(true);
    expect(showWakeupClosedHint("unstarted")).toBe(false); // backlog, todo
    expect(showWakeupClosedHint("started")).toBe(false); // in_progress, in_review, blocked
    expect(showWakeupClosedHint(undefined)).toBe(false);
    const withHint = BUILT_IN_STATUS_ORDER.filter((s) => showWakeupClosedHint(statusCategoryOfKey(s)));
    expect(withHint).toEqual(["done", "cancelled"]);
  });

  describe("section state: empty vs loading vs error", () => {
    it("loading while pending without data", () => {
      expect(wakeupSectionState({ isPending: true, isError: false, data: undefined })).toBe("loading");
    });
    it("empty only after a successful empty answer", () => {
      expect(wakeupSectionState({ isPending: false, isError: false, data: [] })).toBe("empty");
    });
    it("error is not shown as empty, even with an empty fallback list", () => {
      expect(wakeupSectionState({ isPending: false, isError: true, data: undefined })).toBe("error");
      expect(wakeupSectionState({ isPending: false, isError: true, data: [] })).toBe("error");
    });
    it("cached rows stay visible on a failed refetch", () => {
      expect(wakeupSectionState({ isPending: false, isError: true, data: [rule()] })).toBe("ready");
    });
  });

  it("English and Chinese strings exist for the row parts", async () => {
    await i18n.changeLanguage("en");
    expect(wakeupTriggerText(rule({ kind: "unknown" }), {}, NOW)).toBe("Wakeup of an unknown type");
    await i18n.changeLanguage("zh-Hans");
    expect(wakeupTriggerText(rule({ kind: "unknown" }), {}, NOW)).toBe("未知类型的唤醒");
    expect(wakeupPausedText(rule({ paused_reason: "loop" }))).toBe("已被系统暂停：检测到循环");
  });
});

describe("wakeupSectionAutoOpen", () => {
  const base = { expand: false, defaultOpen: true, state: "ready" as const, hasActive: true };

  it("opens with an active rule", () => {
    expect(wakeupSectionAutoOpen(false, base)).toBe(true);
  });

  it("stays open after the last active rule was switched off", () => {
    const first = wakeupSectionAutoOpen(false, base);
    expect(first).toBe(true);
    expect(wakeupSectionAutoOpen(first, { ...base, hasActive: false })).toBe(true);
  });

  it("starts collapsed with only switched-off rules, while loading or empty", () => {
    expect(wakeupSectionAutoOpen(false, { ...base, hasActive: false })).toBe(false);
    expect(wakeupSectionAutoOpen(false, { ...base, state: "loading" })).toBe(false);
    expect(wakeupSectionAutoOpen(false, { ...base, state: "empty", hasActive: false })).toBe(false);
  });

  it("opens on error and when expanded from the overview", () => {
    expect(wakeupSectionAutoOpen(false, { ...base, state: "error", hasActive: false })).toBe(true);
    expect(wakeupSectionAutoOpen(false, { ...base, hasActive: false, expand: true })).toBe(true);
  });

  it("stays shut during a deep-link landing", () => {
    expect(wakeupSectionAutoOpen(false, { ...base, defaultOpen: false })).toBe(false);
  });
});
