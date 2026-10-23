// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SystemWakeupListSchema, type MobileSystemWakeup } from "@/data/wakeup-schemas";
import { i18n } from "./i18n/singleton";
import {
  checkSystemInstruction,
  knownSystemWakeups,
  systemWakeupA11yLabel,
  systemWakeupBlockedHint,
  systemWakeupExtraHint,
  systemWakeupPutBody,
  systemWakeupSummary,
  systemWakeupTitle,
} from "./system-wakeup";

function rule(over: Record<string, unknown> = {}): MobileSystemWakeup {
  // Through the real schema, so defaults match what the API layer yields.
  const [parsed] = SystemWakeupListSchema.parse([
    {
      rule: "child_done",
      enabled: true,
      total: 5,
      remaining: 2,
      target: { type: "agent", id: "a-1", name: "planner" },
      ...over,
    },
  ]);
  return parsed!;
}

describe("system wakeup child_done", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("de");
  });
  afterEach(async () => {
    await i18n.changeLanguage("en");
  });

  describe("PUT body", () => {
    it("the switch sends only enabled, never the instruction", () => {
      expect(systemWakeupPutBody({ enabled: false })).toEqual({ enabled: false });
      expect(systemWakeupPutBody({ enabled: true })).toEqual({ enabled: true });
    });

    it("saving sends the trimmed instruction, empty = back to the default", () => {
      expect(systemWakeupPutBody({ instruction: "  Prüfen  " })).toEqual({ instruction: "Prüfen" });
      expect(systemWakeupPutBody({ instruction: "   " })).toEqual({ instruction: "" });
    });

    it("both fields together, nothing for an empty patch", () => {
      expect(systemWakeupPutBody({ enabled: true, instruction: "x" })).toEqual({ enabled: true, instruction: "x" });
      expect(systemWakeupPutBody({})).toEqual({});
    });
  });

  describe("instruction check", () => {
    it("empty is allowed (default applies), unchanged is not saveable", () => {
      expect(checkSystemInstruction("  ", "alt")).toEqual({ ok: true, instruction: "" });
      expect(checkSystemInstruction(" alt ", "alt")).toEqual({ ok: false, reason: "unchanged" });
    });

    it("counts UTF-8 bytes against the 4000 limit", () => {
      expect(checkSystemInstruction("a".repeat(4000), "").ok).toBe(true);
      expect(checkSystemInstruction("ä".repeat(2001), "")).toEqual({ ok: false, reason: "too_long" });
    });
  });

  describe("blocked hint per value", () => {
    it("none for an empty value", () => {
      expect(systemWakeupBlockedHint("")).toBeNull();
      expect(systemWakeupBlockedHint(null)).toBeNull();
    });

    it.each([
      ["backlog", "Issue im Backlog – greift erst, wenn es den Backlog verlässt"],
      ["member_assignee", "Zuständig ist ein Mensch – Benachrichtigung statt Lauf"],
      ["no_assignee", "Niemand zuständig – es wird niemand geweckt"],
      ["frozen", "Greift gerade nicht (Grund unbekannt, neuere Server-Version)"],
    ])("%s", (blocked, text) => {
      expect(systemWakeupBlockedHint(blocked)).toBe(text);
    });

    it("an unknown value survives the schema and still gets the neutral hint", () => {
      expect(systemWakeupBlockedHint(rule({ blocked: "budget_stop" }).blocked)).toMatch(/Grund unbekannt/);
    });

    it("every hint exists in en and zh-Hans too", async () => {
      for (const lng of ["en", "zh-Hans"]) {
        await i18n.changeLanguage(lng);
        for (const b of ["backlog", "member_assignee", "no_assignee", "x"]) {
          expect(systemWakeupBlockedHint(b)).not.toMatch(/wakeups\.system/);
        }
      }
    });
  });

  describe("row text", () => {
    it("on: progress and who is woken", () => {
      expect(systemWakeupSummary(rule())).toBe("an · 2 von 5 offen · weckt planner");
    });

    it("member assignee: who is notified (hint shown separately)", () => {
      const r = rule({ blocked: "member_assignee", target: { type: "member", id: "m", name: "admin" } });
      expect(systemWakeupSummary(r)).toBe("an · 2 von 5 offen · benachrichtigt admin im Posteingang");
    });

    it("backlog / unknown replace the target with the hint", () => {
      expect(systemWakeupSummary(rule({ blocked: "backlog" }))).toMatch(/^an · 2 von 5 offen · Issue im Backlog/);
      expect(systemWakeupSummary(rule({ blocked: "frozen" }))).toMatch(/Grund unbekannt/);
    });

    it("off and paused win over everything else", () => {
      expect(systemWakeupSummary(rule({ enabled: false, blocked: "backlog" }))).toBe("Für dieses Issue aus");
      expect(systemWakeupSummary(rule({ paused_reason: "loop" }))).toBe("Vom System pausiert: Schleife erkannt");
    });

    it("no sub-issues yet: no progress part", () => {
      expect(systemWakeupSummary(rule({ total: 0, remaining: 0 }))).toBe("an · weckt planner");
    });

    it("title per stage", () => {
      expect(systemWakeupTitle(rule())).toBe("Wenn alle Unteraufgaben fertig sind");
      expect(systemWakeupTitle(rule({ staged: true, stage: 2 }))).toBe("Wenn die Unteraufgaben von Stufe 2 fertig sind");
    });

    it("TalkBack label carries badge, title, state and the hint once", () => {
      const label = systemWakeupA11yLabel(rule({ blocked: "backlog" }));
      expect(label.startsWith("System. Wenn alle Unteraufgaben fertig sind. an · 2 von 5 offen")).toBe(true);
      expect(label.split("Issue im Backlog").length).toBe(2);
      const member = rule({ blocked: "member_assignee", target: { type: "member", id: "m", name: "admin" } });
      expect(systemWakeupA11yLabel(member)).toMatch(/Posteingang\. Zuständig ist ein Mensch/);
    });

    it("extra hint line only for a member assignee on an active rule", () => {
      expect(systemWakeupExtraHint(rule({ blocked: "member_assignee" }))).toMatch(/Mensch/);
      expect(systemWakeupExtraHint(rule({ blocked: "member_assignee", enabled: false }))).toBeNull();
      expect(systemWakeupExtraHint(rule({ blocked: "backlog" }))).toBeNull();
    });
  });

  it("only known rules are shown", () => {
    expect(knownSystemWakeups([rule(), rule({ rule: "parent_done" })]).map((r) => r.rule)).toEqual(["child_done"]);
  });
});
