import { describe, expect, it } from "vitest";
import {
  CHAT_BUBBLE_INSET,
  COMMENT_CARD_INSET,
  chatBubbleContentWidth,
  commentCardContentWidth,
} from "./content-width";
import { markdownToSpeech, proseToSpeech } from "./speech";
import { splitMarkdown } from "./split-markdown";
import {
  TABLE_CARD_LABEL_MAX,
  TABLE_CELL_PADDING_H,
  TABLE_COL_MIN,
  TABLE_WORD_CAP,
  chooseTableLayout,
  columnLabel,
  tableToSpeech,
  type TableModel,
} from "./table-model";

// A real-world status table from a German team comment.
const STATUS_TABLE = [
  "| Teil | Stand |",
  "| --- | --- |",
  "| **Welle 1:** Live-Aktualisierung, Issue-Listen (Reiter, Filter, Sortierung, Ansichten, Mehrfachauswahl), „Mir zugewiesen“, Wakeups, Autopilots, Runtimes | **fertig**, alle Arbeitspakete done. Deine Abnahme am Handy ([TASK-101](mention://issue/00000000-0000-4000-8000-000000000101), APK 1.0.0-b1 anbei) steht seit 01.01. offen. |",
  "| **Tablet-Layout** (diese Karte) | **fertig** und veröffentlicht |",
  "| Offline: Kaltstart ohne Netz zeigt Login, Projekte offline leer ([TASK-102](mention://issue/00000000-0000-4000-8000-000000000102)) | vorbereitet, wartet auf deine Entscheidung in TASK-101 (Frage 2) |",
  "| Neue Chats fehlen in der Chat-Liste (TASK-103) | offen (Backlog) |",
  "| Gelegentliche Hänger (TASK-104) | in Arbeit (Messen und Optimieren) |",
  "| **Welle 2 ff.:** Verwaltung wie im Web (Settings, Mitglieder, Agents/Squads bearbeiten, Autopilots anlegen, Skills …), Tabelle/Gantt, Board-Gruppierung, Tablet Phase 2 | **nicht gestartet**, wartet auf deine Entscheidung in TASK-101 (Frage 3) |",
].join("\n");

// Five columns with inline-code paths.
const WIDE = [
  "| VM | Dienst | Status | Pfad | Nächster Schritt |",
  "|---|---|---|---|---|",
  "| db-1 | qemu-guest-agent | **ok** | `/var/log/app0/app0.log` | keiner |",
  "| db-2 | build-runner-1 | **hängt** | `/etc/ci/runner.yaml` | Neustart durch ops-team-01 |",
  "| db-3 | media-api | **ok** | `/srv/media/.env` | Deploy mit Feedback |",
].join("\n");

function tableOf(md: string): TableModel {
  const seg = splitMarkdown(md).find((s) => s.type === "table");
  if (!seg || seg.type !== "table") throw new Error("no table segment");
  return seg.table;
}

const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);

describe("chooseTableLayout (criteria 1–4)", () => {
  const statusTable = tableOf(STATUS_TABLE);
  const wide = tableOf(WIDE);

  it("1: the status table is a grid at 100 % and 130 %, cards at 200 % (W=363)", () => {
    expect(chooseTableLayout(statusTable, 363, 1).mode).toBe("grid");
    expect(chooseTableLayout(statusTable, 363, 1.3).mode).toBe("grid");
    expect(chooseTableLayout(statusTable, 363, 2).mode).toBe("cards");
  });

  it("1: same result with the real bubble and comment-card widths at 411 dp", () => {
    for (const W of [chatBubbleContentWidth(411), commentCardContentWidth(411)]) {
      expect(chooseTableLayout(statusTable, W, 1).mode).toBe("grid");
      expect(chooseTableLayout(statusTable, W, 2).mode).toBe("cards");
    }
  });

  it("2: five columns are cards at 363 dp and a grid at 752 dp", () => {
    expect(chooseTableLayout(wide, 363, 1).mode).toBe("cards");
    expect(chooseTableLayout(wide, 752, 1).mode).toBe("grid");
  });

  it("3: grid columns sum to W and none is below its minimum", () => {
    const cases: [TableModel, number, number][] = [
      [statusTable, 363, 1],
      [statusTable, 363, 1.3],
      [statusTable, 752, 1],
      [wide, 752, 1],
      [wide, 1200, 1],
    ];
    for (const [table, W, fs] of cases) {
      const l = chooseTableLayout(table, W, fs);
      if (l.mode !== "grid") throw new Error(`expected grid at W=${W} fs=${fs}`);
      expect(Math.abs(sum(l.widths) - W)).toBeLessThanOrEqual(1);
      l.widths.forEach((w, i) => expect(w).toBeGreaterThanOrEqual(l.minWidths[i] - 0.001));
    }
  });

  it("4: a long inline-code cell never forces more than 112 × fs + 20", () => {
    const path = "`/var/log/app0/app0.log/" + "x".repeat(40) + "`";
    const t = tableOf(`| a | Pfad |\n|---|---|\n| 1 | ${path} |\n`);
    for (const fs of [1, 1.3, 2]) {
      const l = chooseTableLayout(t, 363, fs);
      expect(l.minWidths[1]).toBeLessThanOrEqual(TABLE_WORD_CAP * fs + 2 * TABLE_CELL_PADDING_H);
    }
    // The status table at 100 %: still a grid, the code column only gets its share.
    expect(chooseTableLayout(t, 363, 1).mode).toBe("grid");
  });

  it("gives narrow columns at least the minimum width", () => {
    const l = chooseTableLayout(tableOf("| a | b |\n|---|---|\n| 1 | 2 |\n"), 300, 1);
    expect(l.minWidths).toEqual([TABLE_COL_MIN + 20, TABLE_COL_MIN + 20]);
    expect(l.mode).toBe("grid");
  });

  it("cards: header beside the value from 280 dp × fs, else above it", () => {
    const at = (W: number, fs: number) => chooseTableLayout(wide, W, fs);
    const side = at(363, 1);
    if (side.mode !== "cards") throw new Error("expected cards");
    expect(side.sideBySide).toBe(true);
    expect(side.labelWidth).toBeLessThanOrEqual(TABLE_CARD_LABEL_MAX);
    const stacked = at(363, 2);
    if (stacked.mode !== "cards") throw new Error("expected cards");
    expect(stacked.sideBySide).toBe(false);
  });
});

describe("tableToSpeech (criterion 5)", () => {
  it("reads rows as 'header: value' without pipes or dashes", () => {
    const speech = tableToSpeech(tableOf(STATUS_TABLE));
    expect(speech.startsWith("Tabelle, 6 Zeilen, 2 Spalten. Zeile 1: Teil: Welle 1: Live-")).toBe(
      true,
    );
    expect(speech).toContain("Zeile 2: Teil: Tablet-Layout (diese Karte); Stand: fertig und veröffentlicht.");
    expect(speech).not.toMatch(/\||---/);
  });

  it("leaves empty cells out and names missing headers 'Spalte n'", () => {
    const t = tableOf("| Name |  |\n|---|---|\n| a | b |\n|  | c |\n");
    expect(columnLabel(t, 1)).toBe("Spalte 2");
    expect(tableToSpeech(t)).toBe(
      "Tabelle, 2 Zeilen, 2 Spalten. Zeile 1: Name: a; Spalte 2: b. Zeile 2: Spalte 2: c.",
    );
  });

  it("uses singular forms for one row and one column", () => {
    expect(tableToSpeech(tableOf("| a |\n|---|\n| 1 |\n"))).toBe(
      "Tabelle, 1 Zeile, 1 Spalte. Zeile 1: a: 1.",
    );
  });
});

describe("markdownToSpeech", () => {
  it("keeps prose and replaces the table with its speech text", () => {
    const md = `## Stand\n\n${STATUS_TABLE}\n\nWas dich weiterbringt.`;
    const speech = markdownToSpeech(md);
    expect(speech).toContain("Stand");
    expect(speech).toContain("Tabelle, 6 Zeilen, 2 Spalten.");
    expect(speech).toContain("Was dich weiterbringt.");
    expect(speech).not.toContain("| --- |");
  });

  it("reads headings without their hash marks", () => {
    const speech = markdownToSpeech(`## Stand Ver 2.0\n\n${STATUS_TABLE}`);
    expect(speech.startsWith("Stand Ver 2.0\n")).toBe(true);
    expect(speech).not.toContain("#");
  });

  it("drops bold and italic markup in prose, keeps code", () => {
    expect(markdownToSpeech("**hallo** _du_ `x`")).toBe("hallo du `x`");
  });
});

describe("proseToSpeech", () => {
  it("strips ATX headings of every level, also with closing hashes", () => {
    expect(proseToSpeech("# Eins\ntext\n### Drei ###\n   ###### Sechs")).toBe("Eins\ntext\nDrei\nSechs");
  });

  it("keeps hashes that are no heading", () => {
    expect(proseToSpeech("#hashtag, Issue #12, C# und ####### sieben")).toBe(
      "#hashtag, Issue #12, C# und ####### sieben",
    );
  });

  it("removes bold and italic with stars and underscores", () => {
    expect(proseToSpeech("**fett** und __auch__, *kursiv* und _auch_")).toBe(
      "fett und auch, kursiv und auch",
    );
    expect(proseToSpeech("***beides***")).toBe("beides");
  });

  it("leaves snake_case, lone stars and arithmetic alone", () => {
    expect(proseToSpeech("file_name_x, 5 * 3 * 2, a*b")).toBe("file_name_x, 5 * 3 * 2, a*b");
  });
});

describe("content widths", () => {
  it("subtracts the known paddings and never goes negative", () => {
    expect(chatBubbleContentWidth(411)).toBe(411 - CHAT_BUBBLE_INSET);
    expect(commentCardContentWidth(411)).toBe(411 - COMMENT_CARD_INSET);
    expect(chatBubbleContentWidth(10)).toBe(0);
  });
});
