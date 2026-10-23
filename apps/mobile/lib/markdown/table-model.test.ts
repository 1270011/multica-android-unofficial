import { describe, expect, it } from "vitest";
import { splitMarkdown } from "./split-markdown";
import {
  cellText,
  decodeEntities,
  estimateColumnWidths,
  TABLE_COL_MAX,
  TABLE_COL_MIN,
  type TableModel,
} from "./table-model";

// Shape of a real status comment (4 columns, inline code paths).
const WIDE_TABLE = [
  "Stand der Prüfung:",
  "",
  "| VM | Befund | Pfad | Nächster Schritt |",
  "|---|:---:|---|--:|",
  "| db-1 | **ok**, neu geladen | `/var/log/app` | nichts |",
  "| db-2 | *Abweichung* in [MUL-253](mention://issue/abc) | `/etc/app/conf.d/local` | Neu laden &amp; prüfen |",
  "",
  "Danach weiter.",
].join("\n");

function tableOf(md: string): TableModel {
  const seg = splitMarkdown(md).find((s) => s.type === "table");
  if (!seg || seg.type !== "table") throw new Error("no table segment");
  return seg.table;
}

describe("splitMarkdown – tables", () => {
  it("lifts a top-level table into its own segment between prose", () => {
    const segs = splitMarkdown(WIDE_TABLE);
    expect(segs.map((s) => s.type)).toEqual(["prose", "table", "prose"]);
    expect(segs[0]).toEqual({ type: "prose", content: "Stand der Prüfung:" });
    expect(segs[2]).toEqual({ type: "prose", content: "Danach weiter." });
  });

  it("keeps header, alignment and every cell", () => {
    const t = tableOf(WIDE_TABLE);
    expect(t.align).toEqual([null, "center", null, "right"]);
    expect(t.header.map(cellText)).toEqual([
      "VM",
      "Befund",
      "Pfad",
      "Nächster Schritt",
    ]);
    expect(t.rows).toHaveLength(2);
    expect(t.rows[1].map(cellText)).toEqual([
      "db-2",
      "Abweichung in MUL-253",
      "/etc/app/conf.d/local",
      "Neu laden & prüfen",
    ]);
  });

  it("maps inline formatting, code and links to runs", () => {
    const t = tableOf(WIDE_TABLE);
    expect(t.rows[0][1]).toEqual([
      { text: "ok", bold: true },
      { text: ", neu geladen" },
    ]);
    expect(t.rows[0][2]).toEqual([{ text: "/var/log/app", code: true }]);
    expect(t.rows[1][1]).toEqual([
      { text: "Abweichung", italic: true },
      { text: " in " },
      { text: "MUL-253", href: "mention://issue/abc" },
    ]);
  });

  it("pads short rows so every row has all columns", () => {
    const t = tableOf("| a | b | c |\n|---|---|---|\n| 1 |\n");
    expect(t.rows[0]).toHaveLength(3);
    expect(t.rows[0].map(cellText)).toEqual(["1", "", ""]);
  });

  it("leaves tables nested in a list inside the prose stream", () => {
    const md = "- Punkt\n\n  | a | b |\n  |---|---|\n  | 1 | 2 |\n";
    expect(splitMarkdown(md).map((s) => s.type)).toEqual(["prose"]);
  });

  it("does not change code, quotes or paragraphs around it", () => {
    const md = "> Zitat\n\n```sh\nls\n```\n\n| a |\n|---|\n| 1 |\n\nText";
    expect(splitMarkdown(md)).toEqual([
      { type: "prose", content: "> Zitat" },
      { type: "code", lang: "sh", code: "ls" },
      expect.objectContaining({ type: "table" }),
      { type: "prose", content: "Text" },
    ]);
  });
});

describe("estimateColumnWidths", () => {
  it("clamps every column to [min, max]", () => {
    const t = tableOf(
      `| a | ${"x".repeat(200)} |\n|---|---|\n| 1 | 2 |\n`,
    );
    expect(estimateColumnWidths(t)).toEqual([TABLE_COL_MIN, TABLE_COL_MAX]);
  });

  it("makes the 4-column table wider than a phone column", () => {
    const widths = estimateColumnWidths(tableOf(WIDE_TABLE));
    expect(widths).toHaveLength(4);
    // 360 dp screen minus chat padding: the table must scroll, not clip.
    expect(widths.reduce((a, b) => a + b, 0)).toBeGreaterThan(330);
    // The code path column is the widest one.
    expect(Math.max(...widths)).toBe(widths[2]);
  });

  it("uses the longest line of a multi-line cell", () => {
    const t = tableOf("| h |\n|---|\n| aaaaaaaaaaaaaaaa<br>b |\n");
    const [w] = estimateColumnWidths(t);
    expect(w).toBeGreaterThan(TABLE_COL_MIN);
  });
});

describe("decodeEntities", () => {
  it("decodes named and numeric entities and keeps unknown ones", () => {
    expect(decodeEntities("a &amp; b &#39;c&#x27; &lt;d&gt; &foo;")).toBe(
      "a & b 'c' <d> &foo;",
    );
  });
});
