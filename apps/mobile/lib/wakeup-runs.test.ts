// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WakeupRunListSchema, type WakeupRun } from "@/data/wakeup-schemas";
import { i18n } from "./i18n/singleton";
import {
  wakeupRunDurationMs,
  wakeupRunOutcome,
  wakeupRunOutcomeText,
  wakeupRunRow,
  wakeupRunStatusLabel,
  wakeupRunTone,
  wakeupRunTriggersText,
  wakeupRunTriggerText,
} from "./wakeup-runs";

// Fixed "now": Sat 2026-10-17 12:00 local time.
const NOW = new Date(2026, 9, 17, 12, 0, 0);

function run(over: Record<string, unknown> = {}): WakeupRun {
  // Through the real schema so defaults match what the API layer yields.
  const [parsed] = WakeupRunListSchema.parse([{ id: "t-1", status: "completed", ...over }]);
  return parsed!;
}

describe("wakeup-runs", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("de");
  });
  afterEach(async () => {
    await i18n.changeLanguage("en");
  });

  describe("status label and tone", () => {
    it("known statuses are translated", () => {
      expect(wakeupRunStatusLabel("completed")).toBe("Lauf erfolgreich");
      expect(wakeupRunStatusLabel("failed")).toBe("Lauf fehlgeschlagen");
      expect(wakeupRunStatusLabel("running")).toBe("Läuft");
      expect(wakeupRunStatusLabel("queued")).toBe("In der Warteschlange");
      expect(wakeupRunStatusLabel("cancelled")).toBe("Abgebrochen");
    });
    it("an unknown status shows its raw text, an empty one a neutral word", () => {
      expect(wakeupRunStatusLabel("paused_by_daemon")).toBe("paused_by_daemon");
      expect(wakeupRunStatusLabel("")).toBe("Unbekannter Status");
    });
    it("a broken status from the server parses to the neutral word", () => {
      expect(wakeupRunStatusLabel(run({ status: 42 }).status)).toBe("Unbekannter Status");
    });
    it("tone per status, unknown is muted", () => {
      expect(wakeupRunTone("completed")).toBe("success");
      expect(wakeupRunTone("failed")).toBe("danger");
      expect(wakeupRunTone("running")).toBe("running");
      expect(wakeupRunTone("deferred")).toBe("warning");
      expect(wakeupRunTone("cancelled")).toBe("muted");
      expect(wakeupRunTone("whatever")).toBe("muted");
    });
  });

  describe("triggers", () => {
    it("platform facts and workspace events in words", () => {
      expect(wakeupRunTriggerText("time.due")).toBe("Zeit erreicht");
      expect(wakeupRunTriggerText("wakeup.manual")).toBe("Von Hand");
      expect(wakeupRunTriggerText("wakeup.timeout")).toBe("Frist abgelaufen");
      expect(wakeupRunTriggerText("condition.met")).toBe("Bedingung erfüllt");
      expect(wakeupRunTriggerText("comment.created")).toBe("Bei neuem Kommentar");
      expect(wakeupRunTriggerText("task.completed", "planner")).toBe("Wenn planner einen Lauf erfolgreich beendet");
    });
    it("an unknown event is shown as it is", () => {
      expect(wakeupRunTriggerText("issue.exploded")).toBe("issue.exploded");
    });
    it("list without duplicates, null without facts", () => {
      expect(wakeupRunTriggersText(run({ triggers: ["time.due", "time.due", "wakeup.manual"] }))).toBe(
        "Auslöser: Zeit erreicht, Von Hand",
      );
      expect(wakeupRunTriggersText(run({ triggers: [] }))).toBeNull();
      expect(wakeupRunTriggersText(run({ triggers: "nope" }))).toBeNull();
    });
  });

  describe("commented / check-in", () => {
    it("commented", () => {
      expect(wakeupRunOutcomeText(run({ commented: true }))).toBe("Hat kommentiert");
      expect(wakeupRunOutcome(run({ commented: true }))).toBe("commented");
    });
    it("check-in note wins and is trimmed", () => {
      const r = run({ commented: true, checkin_note: "  nichts Neues  " });
      expect(wakeupRunOutcomeText(r)).toBe("Still beendet: nichts Neues");
      expect(wakeupRunOutcome(r)).toBe("checkin");
    });
    it("neither", () => {
      expect(wakeupRunOutcomeText(run({ checkin_note: "   " }))).toBeNull();
      expect(wakeupRunOutcome(run())).toBe("none");
    });
  });

  describe("duration", () => {
    it("from start to end", () => {
      expect(
        wakeupRunDurationMs(run({ started_at: "2026-10-17T10:00:00Z", completed_at: "2026-10-17T10:03:05Z" })),
      ).toBe(185_000);
    });
    it("null while running, for broken or reversed times", () => {
      expect(wakeupRunDurationMs(run({ started_at: "2026-10-17T10:00:00Z", completed_at: null }))).toBeNull();
      expect(wakeupRunDurationMs(run({ started_at: "kaputt", completed_at: "2026-10-17T10:00:00Z" }))).toBeNull();
      expect(
        wakeupRunDurationMs(run({ started_at: "2026-10-17T10:05:00Z", completed_at: "2026-10-17T10:00:00Z" })),
      ).toBeNull();
    });
  });

  describe("row", () => {
    it("status, time, duration, triggers, outcome and TalkBack label", () => {
      const started = new Date(2026, 9, 17, 9, 0, 0);
      const done = new Date(2026, 9, 17, 9, 3, 5);
      const row = wakeupRunRow(
        run({
          status: "completed",
          created_at: started.toISOString(),
          started_at: started.toISOString(),
          completed_at: done.toISOString(),
          triggers: ["comment.created"],
          commented: true,
        }),
        "planner",
        NOW,
      );
      expect(row.status).toBe("Lauf erfolgreich");
      expect(row.tone).toBe("success");
      expect(row.meta).toBe("Heute 09:00 · 3 Min 5 s");
      expect(row.triggers).toBe("Auslöser: Bei neuem Kommentar");
      expect(row.outcome).toBe("Hat kommentiert");
      expect(row.a11y).toBe(
        "Lauf erfolgreich, Heute 09:00 · 3 Min 5 s, Auslöser: Bei neuem Kommentar, Hat kommentiert",
      );
    });
    it("queued run: queue time, no duration; unknown status still renders", () => {
      const queued = new Date(2026, 9, 17, 11, 30, 0).toISOString();
      const row = wakeupRunRow(run({ status: "brand_new", created_at: queued }), null, NOW);
      expect(row.status).toBe("brand_new");
      expect(row.tone).toBe("muted");
      expect(row.meta).toBe("Heute 11:30");
      expect(row.triggers).toBeNull();
      expect(row.outcome).toBeNull();
      expect(row.a11y).toBe("brand_new, Heute 11:30");
    });
    it("English labels", async () => {
      await i18n.changeLanguage("en");
      const row = wakeupRunRow(run({ status: "", checkin_note: "all quiet", triggers: ["wakeup.manual"] }), null, NOW);
      expect(row.status).toBe("Unknown status");
      expect(row.triggers).toBe("Triggered by: Manual");
      expect(row.outcome).toBe("Ended silently: all quiet");
    });
  });
});
