/**
 * Full table view: layout on the screen width, row-wise TalkBack text,
 * open actions, the key store and the copy text. Pure functions only.
 */
import { lexer, type Tokens } from "marked";
import { describe, expect, it } from "vitest";
import {
  breakPieceWidth,
  chooseTableLayout,
  fullViewTableLayout,
  rowLinks,
  tableFromToken,
  tableIndexFromAction,
  tableOpenActions,
  tableRowToSpeech,
  tableToMarkdown,
  TABLE_ACTION_PREFIX,
  TABLE_CELL_PADDING_H,
} from "./table-model";
import {
  getTableForView,
  getTableNode,
  registerTableNode,
  markTableViewRotated,
  putTableForView,
  probeTableRow,
  registerTableRowProbe,
  setTableViewOrigin,
  takeTableViewReturn,
  TABLE_VIEW_STORE_MAX,
} from "./table-view-store";

function table(md: string) {
  const tok = lexer(md).find((t) => t.type === "table") as Tokens.Table;
  return tableFromToken(tok);
}

const STATUS_TABLE = table(`| Teil | Stand |
| --- | --- |
| **Welle 1:** Live-Aktualisierung, Issue-Listen (Reiter, Filter, Sortierung, Ansichten, Mehrfachauswahl), „Mir zugewiesen“, Wakeups, Autopilots, Runtimes | **fertig**, alle Arbeitspakete done. Deine Abnahme am Handy ([TASK-101](mention://issue/00000000-0000-4000-8000-000000000101), APK 1.0.0-b1 anbei) steht seit 01.01. offen. |
| **Tablet-Layout** (diese Karte) | **fertig** und veröffentlicht |
| Offline: Kaltstart ohne Netz zeigt Login | |
`);

// 8 columns with long words: does not fit a phone in portrait (criterion 15).
const EIGHT =
  table(`| Komponente | Verantwortlichkeit | Zustandsbeschreibung | Abhängigkeiten | Konfigurationsdatei | Überwachungsintervall | Wiederherstellung | Dokumentation |
|---|---|---|---|---|---|---|---|
| Datenbankreplikation | Infrastrukturverwaltung | Betriebsbereitschaft | Netzwerkanbindung | Replikationsparameter | Minutenintervall | Sicherungswiederherstellung | Betriebshandbuch |
| Zertifikatsverwaltung | Sicherheitsabteilung | Ablaufüberwachung | Zertifizierungsstelle | Zertifikatskonfiguration | Stundenintervall | Neuausstellung | Sicherheitsrichtlinie |
`);

const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);

describe("fullViewTableLayout", () => {
  it("fills the screen width with a grid when the minimum widths fit", () => {
    const l = fullViewTableLayout(STATUS_TABLE, 387, 1);
    expect(l.scroll).toBe(false);
    expect(l.contentWidth).toBe(387);
    expect(sum(l.widths)).toBeCloseTo(387, 0);
  });

  it("is never cards: 200 % font in landscape is a grid, in portrait the minimum widths scroll", () => {
    expect(chooseTableLayout(STATUS_TABLE, 363, 2).mode).toBe("cards");
    const land = fullViewTableLayout(STATUS_TABLE, 826, 2);
    expect(land.scroll).toBe(false);
    expect(sum(land.widths)).toBeCloseTo(826, 0);
    const port = fullViewTableLayout(STATUS_TABLE, 387, 2);
    expect(port.scroll).toBe(true);
    expect(port.contentWidth).toBeGreaterThan(387);
    expect(sum(port.widths)).toBeCloseTo(port.contentWidth, 5);
    for (const w of port.widths) expect(w).toBeLessThanOrEqual(320 * 2 + 20 + 0.01);
  });

  it("never breaks inside a word at 200 %: columns fit the longest piece between break points", () => {
    // Seen on a device: "Live-A / ktualisierung", "Meh / rfachauswahl".
    const port = fullViewTableLayout(STATUS_TABLE, 387, 2);
    const inner = port.widths[0] - 2 * TABLE_CELL_PADDING_H;
    for (const piece of ["Aktualisierung,", "Mehrfachauswahl),", "(Reiter,", "Sortierung,"]) {
      expect(inner).toBeGreaterThanOrEqual(breakPieceWidth([{ text: piece }]) * 2);
    }
  });

  it("8 columns with long words scroll sideways in portrait, at their minimum widths", () => {
    const l = fullViewTableLayout(EIGHT, 387, 1);
    expect(l.scroll).toBe(true);
    expect(l.contentWidth).toBeGreaterThan(387);
    expect(sum(l.widths)).toBeCloseTo(l.contentWidth, 5);
    // Every column is as wide as its longest word plus padding, no wider.
    l.widths.forEach((w, c) => {
      const longest = Math.max(
        ...[EIGHT.header, ...EIGHT.rows].map((r) => breakPieceWidth(r[c])),
      );
      expect(w).toBeCloseTo(Math.max(56, longest) + 2 * TABLE_CELL_PADDING_H, 5);
    });
  });

  it("the same 8 columns fit without scrolling on a wide screen", () => {
    const l = fullViewTableLayout(EIGHT, 1600, 1);
    expect(l.scroll).toBe(false);
    expect(sum(l.widths)).toBeCloseTo(1600, 0);
  });

  it("on a tablet in landscape they scroll a little instead of breaking 27-letter words", () => {
    const l = fullViewTableLayout(EIGHT, 1256, 1);
    expect(l.scroll).toBe(true);
    expect(l.contentWidth).toBeLessThan(1256 * 1.25);
  });

  it("scales the minimum widths with the font scale", () => {
    const a = fullViewTableLayout(EIGHT, 387, 1);
    const b = fullViewTableLayout(EIGHT, 387, 2);
    expect(b.contentWidth).toBeGreaterThan(a.contentWidth * 1.8);
  });

  it("handles an empty model", () => {
    const empty = { align: [], header: [], rows: [] };
    expect(fullViewTableLayout(empty, 300, 1)).toEqual({
      widths: [],
      contentWidth: 300,
      scroll: false,
    });
  });
});

describe("table without data rows (review nit on #176)", () => {
  const headerOnly =
    table(`| Komponente | Verantwortlichkeit | Zustandsbeschreibung | Abhängigkeiten | Konfigurationsdatei |
|---|---|---|---|---|
`);

  it("is parsed with a header and no rows", () => {
    expect(headerOnly.rows).toHaveLength(0);
    expect(headerOnly.header).toHaveLength(5);
  });

  it("is a single grid row, never an empty card frame, even when it does not fit", () => {
    for (const [W, fs] of [
      [363, 1],
      [363, 2],
      [752, 1],
    ] as const) {
      const l = chooseTableLayout(headerOnly, W, fs);
      expect(l.mode).toBe("grid");
      if (l.mode !== "grid") return;
      expect(sum(l.widths)).toBeCloseTo(W, 5);
    }
  });

  it("the same header with a data row still falls back to cards on a phone", () => {
    const withRow =
      table(`| Komponente | Verantwortlichkeit | Zustandsbeschreibung | Abhängigkeiten | Konfigurationsdatei |
|---|---|---|---|---|
| a | b | c | d | e |
`);
    expect(chooseTableLayout(withRow, 363, 1).mode).toBe("cards");
  });
});

describe("tableRowToSpeech", () => {
  it('reads "Zeile n von m" and header: value pairs', () => {
    expect(tableRowToSpeech(STATUS_TABLE, 1)).toBe(
      "Zeile 2 von 3. Teil: Tablet-Layout (diese Karte); Stand: fertig und veröffentlicht",
    );
  });

  it("leaves empty cells out and keeps the row number", () => {
    expect(tableRowToSpeech(STATUS_TABLE, 2)).toBe(
      "Zeile 3 von 3. Teil: Offline: Kaltstart ohne Netz zeigt Login",
    );
  });

  it("names a column without header 'Spalte n' and uses the given words", () => {
    const t = table(`| | B |\n|---|---|\n| x | y |\n`);
    expect(tableRowToSpeech(t, 0)).toBe("Zeile 1 von 1. Spalte 1: x; B: y");
    expect(
      tableRowToSpeech(t, 0, {
        table: () => "",
        row: (n) => `Row ${n}`,
        column: (n) => `Column ${n}`,
        rowOf: (n, total) => `Row ${n} of ${total}`,
      }),
    ).toBe("Row 1 of 1. Column 1: x; B: y");
  });
});

describe("rowLinks", () => {
  it("lists the links of a row as TalkBack actions", () => {
    expect(rowLinks(STATUS_TABLE, 0)).toEqual([
      { text: "TASK-101", href: "mention://issue/00000000-0000-4000-8000-000000000101" },
    ]);
    expect(rowLinks(STATUS_TABLE, 1)).toEqual([]);
  });

  it("joins adjacent runs of one link", () => {
    const t = table(`| a |\n|---|\n| [**fett** normal](https://x.test) |\n`);
    expect(rowLinks(t, 0)).toEqual([{ text: "fett normal", href: "https://x.test" }]);
  });
});

describe("tableOpenActions", () => {
  const words = { one: "Tabelle in Vollansicht öffnen", nth: (n: number) => `Tabelle ${n} öffnen` };

  it("one table: a single action", () => {
    expect(tableOpenActions(1, words)).toEqual([
      { name: `${TABLE_ACTION_PREFIX}0`, label: "Tabelle in Vollansicht öffnen" },
    ]);
  });

  it("several tables: numbered actions", () => {
    expect(tableOpenActions(3, words).map((a) => a.label)).toEqual([
      "Tabelle 1 öffnen",
      "Tabelle 2 öffnen",
      "Tabelle 3 öffnen",
    ]);
  });

  it("no table: no action", () => {
    expect(tableOpenActions(0, words)).toEqual([]);
  });

  it("maps the action name back to the table index", () => {
    expect(tableIndexFromAction(`${TABLE_ACTION_PREFIX}2`)).toBe(2);
    expect(tableIndexFromAction("reply")).toBeNull();
    expect(tableIndexFromAction(`${TABLE_ACTION_PREFIX}x`)).toBeNull();
  });
});

describe("table-view-store", () => {
  it("returns the stored table for its key", () => {
    const key = putTableForView(STATUS_TABLE);
    expect(getTableForView(key)).toBe(STATUS_TABLE);
    expect(getTableForView(undefined)).toBeUndefined();
    expect(getTableForView("nope")).toBeUndefined();
  });

  it("reuses the key when the same table is opened again", () => {
    expect(putTableForView(EIGHT)).toBe(putTableForView(EIGHT));
  });

  it(`keeps at most ${TABLE_VIEW_STORE_MAX} tables, the oldest goes first`, () => {
    const first = putTableForView(table(`| a |\n|---|\n| 1 |\n`));
    const keys = Array.from({ length: TABLE_VIEW_STORE_MAX }, (_, i) =>
      putTableForView(table(`| a |\n|---|\n| ${i} |\n`)),
    );
    expect(getTableForView(first)).toBeUndefined();
    for (const k of keys) expect(getTableForView(k)).toBeDefined();
  });
});

describe("chat position after the full view", () => {
  it("returns the bubble only after a rotation, and only once", () => {
    setTableViewOrigin("c1", STATUS_TABLE);
    markTableViewRotated();
    expect(takeTableViewReturn()).toEqual({ entryId: "c1", table: STATUS_TABLE, screenTop: null, row: null });
    expect(takeTableViewReturn()).toBeNull();
  });

  it("the TalkBack action without a table still lands on the bubble", () => {
    setTableViewOrigin("c1");
    markTableViewRotated();
    expect(takeTableViewReturn()).toEqual({ entryId: "c1", table: null, screenTop: null, row: null });
  });

  it("remembers where the drawn table stood on screen when it was opened", () => {
    const off = registerTableNode(
      STATUS_TABLE,
      { measureInWindow: (cb) => cb(0, 420, 300, 200) },
      "c1",
    );
    setTableViewOrigin("c1", STATUS_TABLE);
    markTableViewRotated();
    expect(takeTableViewReturn()).toEqual({ entryId: "c1", table: STATUS_TABLE, screenTop: 420, row: null });
    off();
  });

  it("remembers the bubble's row from the chat list's layout", () => {
    const off = registerTableRowProbe((id) => (id === "c1" ? { top: 120, height: 900 } : null));
    setTableViewOrigin("c1", STATUS_TABLE);
    markTableViewRotated();
    expect(takeTableViewReturn()?.row).toEqual({ top: 120, height: 900 });
    off();
    expect(probeTableRow("c1")).toBeNull();
  });

  it("asks every mounted chat list, the first that knows the row answers", () => {
    const offA = registerTableRowProbe(() => null);
    const offB = registerTableRowProbe((id) => (id === "c2" ? { top: 5, height: 50 } : null));
    expect(probeTableRow("c2")).toEqual({ top: 5, height: 50 });
    expect(probeTableRow("c9")).toBeNull();
    offA();
    offB();
  });

  it("without a rotation the list keeps its own place", () => {
    setTableViewOrigin("c1");
    expect(takeTableViewReturn()).toBeNull();
  });

  it("a table without bubble (description) has no return target", () => {
    setTableViewOrigin(undefined);
    markTableViewRotated();
    expect(takeTableViewReturn()).toBeNull();
  });
});

describe("table node registry", () => {
  const node = (y: number) => ({ measureInWindow: (cb: (...a: number[]) => void) => cb(0, y, 100, 50) });

  it("finds the drawn table and forgets it on unmount", () => {
    const n = node(10);
    const off = registerTableNode(STATUS_TABLE, n);
    expect(getTableNode(STATUS_TABLE)).toBe(n);
    off();
    expect(getTableNode(STATUS_TABLE)).toBeUndefined();
    expect(getTableNode(null)).toBeUndefined();
  });

  it("an older unmount does not remove a newer registration (recycled cell)", () => {
    const a = node(1);
    const b = node(2);
    const offA = registerTableNode(STATUS_TABLE, a);
    const offB = registerTableNode(STATUS_TABLE, b);
    offA();
    expect(getTableNode(STATUS_TABLE)).toBe(b);
    offB();
  });

  it("a newer copy unmounting keeps the older one that is still drawn", () => {
    // Chat bubble first, then the landing cover (or the activity card) draws
    // the same model; that copy goes away, the bubble's table stays findable.
    const chat = node(1);
    const cover = node(2);
    const offChat = registerTableNode(STATUS_TABLE, chat, "c1");
    const offCover = registerTableNode(STATUS_TABLE, cover, "c1");
    expect(getTableNode(STATUS_TABLE, "c1")).toBe(cover);
    offCover();
    expect(getTableNode(STATUS_TABLE, "c1")).toBe(chat);
    offChat();
    expect(getTableNode(STATUS_TABLE, "c1")).toBeUndefined();
  });

  it("with an entry id only that comment's copy counts", () => {
    const chat = node(1);
    const card = node(2);
    const offChat = registerTableNode(STATUS_TABLE, chat, "c1");
    const offCard = registerTableNode(STATUS_TABLE, card);
    expect(getTableNode(STATUS_TABLE, "c1")).toBe(chat);
    expect(getTableNode(STATUS_TABLE, "c2")).toBeUndefined();
    expect(getTableNode(STATUS_TABLE)).toBe(card);
    offChat();
    offCard();
  });

  it("opening measures the bubble's copy, not a newer one elsewhere", () => {
    const offChat = registerTableNode(STATUS_TABLE, node(420), "c1");
    const offCard = registerTableNode(STATUS_TABLE, node(90));
    setTableViewOrigin("c1", STATUS_TABLE);
    markTableViewRotated();
    expect(takeTableViewReturn()?.screenTop).toBe(420);
    offChat();
    offCard();
  });
});

describe("tableToMarkdown", () => {
  it("round-trips through the lexer", () => {
    const md = tableToMarkdown(STATUS_TABLE);
    expect(table(md)).toEqual(STATUS_TABLE);
  });

  it("keeps alignment, code and escaped pipes", () => {
    const t = table(`| a | b |\n|:---|---:|\n| \`x\\|y\` | ~~z~~ |\n`);
    const md = tableToMarkdown(t);
    expect(md.split("\n")[1]).toBe("| :--- | ---: |");
    expect(table(md)).toEqual(t);
  });
});
