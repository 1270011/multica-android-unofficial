/**
 * Pure model for top-level GFM tables.
 *
 * enriched-markdown draws tables natively with its own HorizontalScrollView,
 * but inside the chat / comment bubbles (RN `Pressable` with onLongPress) the
 * horizontal swipe never scrolls it: the cells' native long-click opens the
 * library's copy popup instead, and wide tables stay clipped after 1.5
 * columns. The splitter therefore lifts top-level tables out of the prose
 * stream (like fenced code) and `MarkdownTable` renders them itself. That
 * is a wrapping grid or stacked cards chosen by
 * `chooseTableLayout`, never a horizontal ScrollView (it fought the
 * bubble's long-press and swipe-to-reply).
 *
 * Kept free of React / RN imports so vitest can cover it.
 */
import type { Token, Tokens } from "marked";

export type TableAlign = "left" | "center" | "right" | null;

/** A flat run of inline text with the formatting it inherits. */
export interface InlineRun {
  text: string;
  bold?: boolean;
  italic?: boolean;
  strike?: boolean;
  code?: boolean;
  href?: string;
}

export interface TableModel {
  align: TableAlign[];
  header: InlineRun[][];
  rows: InlineRun[][][];
}

type RunStyle = Omit<InlineRun, "text">;

function pushRun(out: InlineRun[], text: string, style: RunStyle) {
  if (!text) return;
  const prev = out[out.length - 1];
  if (
    prev &&
    prev.bold === style.bold &&
    prev.italic === style.italic &&
    prev.strike === style.strike &&
    prev.code === style.code &&
    prev.href === style.href
  ) {
    prev.text += text;
    return;
  }
  out.push({ text, ...style });
}

// marked keeps HTML entities in `text`/`codespan` text (`&amp;`, `&#39;` …);
// RN `<Text>` would print them literally.
const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

export function decodeEntities(s: string): string {
  if (!s.includes("&")) return s;
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, body: string) => {
    if (body[0] === "#") {
      const code =
        body[1] === "x" || body[1] === "X"
          ? parseInt(body.slice(2), 16)
          : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : m;
    }
    return ENTITIES[body.toLowerCase()] ?? m;
  });
}

function walk(tokens: Token[] | undefined, style: RunStyle, out: InlineRun[]) {
  for (const t of tokens ?? []) {
    switch (t.type) {
      case "strong":
        walk((t as Tokens.Strong).tokens, { ...style, bold: true }, out);
        break;
      case "em":
        walk((t as Tokens.Em).tokens, { ...style, italic: true }, out);
        break;
      case "del":
        walk((t as Tokens.Del).tokens, { ...style, strike: true }, out);
        break;
      case "link": {
        const link = t as Tokens.Link;
        walk(link.tokens, { ...style, href: link.href }, out);
        break;
      }
      case "codespan":
        pushRun(out, decodeEntities((t as Tokens.Codespan).text), {
          ...style,
          code: true,
        });
        break;
      case "br":
        pushRun(out, "\n", style);
        break;
      case "image":
        // Images inside a cell can't be laid out in a text run; keep the alt
        // text so nothing silently disappears.
        pushRun(out, (t as Tokens.Image).text ?? "", style);
        break;
      case "html":
        // preprocess strips HTML already; a stray tag must not print.
        break;
      case "text":
      case "escape": {
        const tt = t as Tokens.Text;
        if (tt.tokens && tt.tokens.length > 0) walk(tt.tokens, style, out);
        else pushRun(out, decodeEntities(tt.text), style);
        break;
      }
      default:
        pushRun(out, (t as { raw?: string }).raw ?? "", style);
    }
  }
}

export function inlineRuns(tokens: Token[] | undefined): InlineRun[] {
  const out: InlineRun[] = [];
  walk(tokens, {}, out);
  for (const run of out) {
    // Drop undefined keys so tests and memo comparisons stay simple.
    for (const k of Object.keys(run) as (keyof InlineRun)[]) {
      if (run[k] === undefined) delete run[k];
    }
  }
  return out;
}

export function tableFromToken(token: Tokens.Table): TableModel {
  const align = token.align.map((a) => a ?? null);
  const cols = Math.max(
    align.length,
    token.header.length,
    ...token.rows.map((r) => r.length),
  );
  const pad = (cells: InlineRun[][]) => {
    while (cells.length < cols) cells.push([]);
    return cells;
  };
  while (align.length < cols) align.push(null);
  return {
    align,
    header: pad(token.header.map((c) => inlineRuns(c.tokens))),
    rows: token.rows.map((r) => pad(r.map((c) => inlineRuns(c.tokens)))),
  };
}

export function cellText(cell: InlineRun[]): string {
  return cell.map((r) => r.text).join("");
}

/**
 * Layout rule for tables in bubbles and comment cards:
 * no horizontal scrolling. A table is drawn as a wrapping grid on the full
 * width when every column stays readable, otherwise as stacked cards (one
 * per row, first column as title, then "header: value").
 *
 * Everything is in dp. Character widths are estimates at font scale 1 and
 * get multiplied by `fontScale`; the cell padding does not scale. `W` is the
 * width the table may use (inner width of the bubble or comment card). The
 * caller computes it from the window/pane width and known paddings, so no
 * measure pass is needed and the result is stable while a chat scrolls.
 */
export const TABLE_CELL_PADDING_H = 10;
export const TABLE_CELL_PADDING_V = 6;
/** Narrowest column, about 8 characters. */
export const TABLE_COL_MIN = 56;
/** Longer words and inline code break inside the word beyond this. */
export const TABLE_WORD_CAP = 112;
/** Full view: only longer pieces (URLs, long code) break inside. */
export const TABLE_FULL_WORD_CAP = 320;
/** Cap for a column's preferred (single-line) width. */
export const TABLE_COL_PREF_MAX = 320;
/** A column with long text must get at least this in the grid. */
export const TABLE_READABLE = 100;
/** Cards put header and value side by side from this width on. */
export const TABLE_CARD_SIDE_MIN = 280;
export const TABLE_CARD_PADDING = 12;
/** Share of the card's inner width for the header, capped (× fontScale). */
export const TABLE_CARD_LABEL_SHARE = 0.36;
export const TABLE_CARD_LABEL_MAX = 120;
// Average advance of the 14 sp body font / monospace on Android, in dp.
const CHAR_W = 7.4;
const CODE_CHAR_W = 8.4;

function charWidth(run: InlineRun): number {
  return run.code ? CODE_CHAR_W : run.bold ? CHAR_W * 1.06 : CHAR_W;
}

/** Width of the longest line of a cell (`<br>` starts a new line). */
function lineWidth(cell: InlineRun[]): number {
  let longest = 0;
  let line = 0;
  for (const run of cell) {
    const w = charWidth(run);
    run.text.split("\n").forEach((p, i) => {
      if (i > 0) {
        longest = Math.max(longest, line);
        line = 0;
      }
      line += [...p].length * w;
    });
  }
  return Math.max(longest, line);
}

/** Width of the longest word of a cell. */
function wordWidth(cell: InlineRun[]): number {
  let longest = 0;
  for (const run of cell) {
    const w = charWidth(run);
    for (const word of run.text.split(/\s+/)) {
      longest = Math.max(longest, [...word].length * w);
    }
  }
  return longest;
}

/**
 * Longest unbreakable piece of a cell for the full view: Android
 * breaks a line at spaces and after a hyphen or slash, so "Live-" and
 * "Aktualisierung," are two pieces. Pieces run across style runs
 * ("**fertig**," is one), measured with each run's character width.
 */
export function breakPieceWidth(cell: InlineRun[]): number {
  let longest = 0;
  let piece = 0;
  for (const run of cell) {
    const w = charWidth(run);
    for (const ch of run.text) {
      if (/\s/.test(ch)) {
        piece = 0;
        continue;
      }
      piece += w;
      longest = Math.max(longest, piece);
      if (ch === "-" || ch === "/") piece = 0;
    }
  }
  return longest;
}

export type TableLayout =
  | {
      mode: "grid";
      /** Column widths in dp, summing to W. */
      widths: number[];
      minWidths: number[];
      prefWidths: number[];
    }
  | {
      mode: "cards";
      /** Header left of the value (true) or above it (false). */
      sideBySide: boolean;
      /** Header width in dp when side by side. */
      labelWidth: number;
      minWidths: number[];
      prefWidths: number[];
    };

/**
 * Minimum (longest word) and preferred (longest line) width per column.
 * Default: the bubble's rule, words capped at `TABLE_WORD_CAP` so a long
 * word breaks inside the cell. `full`: the full view's rule, pieces between
 * break points capped only at `TABLE_FULL_WORD_CAP`, so a word that does
 * not fit widens its column instead.
 */
function columnWidths(model: TableModel, fs: number, full = false) {
  const rows = [model.header, ...model.rows];
  const minWidths: number[] = [];
  const prefWidths: number[] = [];
  model.align.forEach((_, c) => {
    let word = 0;
    let line = 0;
    for (const row of rows) {
      word = Math.max(word, full ? breakPieceWidth(row[c] ?? []) : wordWidth(row[c] ?? []));
      line = Math.max(line, lineWidth(row[c] ?? []));
    }
    const cap = full ? TABLE_FULL_WORD_CAP : TABLE_WORD_CAP;
    minWidths[c] = Math.max(TABLE_COL_MIN, Math.min(word, cap)) * fs + 2 * TABLE_CELL_PADDING_H;
    prefWidths[c] =
      Math.max(TABLE_COL_MIN, Math.min(line, TABLE_COL_PREF_MAX)) * fs + 2 * TABLE_CELL_PADDING_H;
  });
  return { minWidths, prefWidths };
}

const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);

/**
 * Grid column widths on `W` (callers check `sum(minWidths) <= W` first):
 * everything on one line stretched to `W`, or every column its minimum and
 * the rest to the columns with the most text (in proportion to how much
 * more they would like).
 */
function distribute(minWidths: number[], prefWidths: number[], W: number): number[] {
  const sMin = sum(minWidths);
  const sPref = sum(prefWidths);
  if (sPref <= W) return prefWidths.map((p) => (p * W) / sPref);
  const slack = prefWidths.map((p, i) => p - minWidths[i]);
  const sSlack = sum(slack) || 1;
  return minWidths.map((m, i) => m + ((W - sMin) * slack[i]) / sSlack);
}

export function chooseTableLayout(
  model: TableModel,
  W: number,
  fontScale: number,
): TableLayout {
  const fs = Math.max(1, fontScale);
  const { minWidths, prefWidths } = columnWidths(model, fs);
  const sMin = sum(minWidths);

  const cards = (): TableLayout => {
    const inner = W - 2 * TABLE_CARD_PADDING * fs;
    return {
      mode: "cards",
      sideBySide: W >= TABLE_CARD_SIDE_MIN * fs,
      labelWidth: Math.min(inner * TABLE_CARD_LABEL_SHARE, TABLE_CARD_LABEL_MAX * fs),
      minWidths,
      prefWidths,
    };
  };
  if (minWidths.length === 0) return cards();
  if (model.rows.length === 0) {
    // Header only (review nit on #176): cards would be an empty
    // frame. A single grid row instead; when even the minimum widths do not
    // fit, they shrink in proportion and the header words wrap in the cell.
    const widths =
      sMin > W
        ? minWidths.map((m) => (m * W) / sMin)
        : distribute(minWidths, prefWidths, W);
    return { mode: "grid", widths, minWidths, prefWidths };
  }
  if (sMin > W) return cards();

  const widths = distribute(minWidths, prefWidths, W);
  const readable = widths.every(
    (w, i) =>
      w >= Math.min(prefWidths[i], TABLE_READABLE * fs + 2 * TABLE_CELL_PADDING_H) - 0.5,
  );
  return readable ? { mode: "grid", widths, minWidths, prefWidths } : cards();
}

export interface FullViewTableLayout {
  /** Column widths in dp. */
  widths: number[];
  /** Width of the grid: `W`, or the sum of the minimum widths when wider. */
  contentWidth: number;
  /** Only when even the minimum widths do not fit `W` (row 15). */
  scroll: boolean;
}

/**
 * Full table view ("Vollansicht"): always a grid, by the
 * same distribution as in the bubble but on the full screen width and
 * without the readability fallback to cards. Words break only at spaces and
 * after hyphens; a word that does not fit widens its column.
 * Horizontal scrolling is the last resort, only when the minimum widths
 * alone are wider than `W`; the columns then keep their minimum width.
 */
export function fullViewTableLayout(
  model: TableModel,
  W: number,
  fontScale: number,
): FullViewTableLayout {
  const fs = Math.max(1, fontScale);
  const { minWidths, prefWidths } = columnWidths(model, fs, true);
  const sMin = sum(minWidths);
  if (minWidths.length === 0) return { widths: [], contentWidth: W, scroll: false };
  if (sMin > W) return { widths: minWidths, contentWidth: sMin, scroll: true };
  return { widths: distribute(minWidths, prefWidths, W), contentWidth: W, scroll: false };
}

export interface TableSpeechWords {
  /** "Tabelle, 6 Zeilen, 2 Spalten" */
  table: (rows: number, cols: number) => string;
  /** "Zeile 1" */
  row: (n: number) => string;
  /** Fallback header: "Spalte 2" */
  column: (n: number) => string;
}

export const GERMAN_TABLE_SPEECH: TableSpeechWords = {
  table: (rows, cols) =>
    `Tabelle, ${rows} ${rows === 1 ? "Zeile" : "Zeilen"}, ${cols} ${cols === 1 ? "Spalte" : "Spalten"}`,
  row: (n) => `Zeile ${n}`,
  column: (n) => `Spalte ${n}`,
};

/** Plain header text, or "Spalte n" (1-based) when it is empty. */
export function columnLabel(
  model: TableModel,
  col: number,
  words: TableSpeechWords = GERMAN_TABLE_SPEECH,
): string {
  return cellText(model.header[col] ?? []).trim() || words.column(col + 1);
}

/**
 * TalkBack text for a table (§3): no `|` or `---`, the same for
 * grid and cards. "Tabelle, 2 Zeilen, 2 Spalten. Zeile 1: Teil: …; Stand: …
 * Zeile 2: …". Empty cells are left out.
 */
export function tableToSpeech(
  model: TableModel,
  words: TableSpeechWords = GERMAN_TABLE_SPEECH,
): string {
  const cols = model.align.length;
  const parts = [`${words.table(model.rows.length, cols)}.`];
  model.rows.forEach((row, r) => {
    const cells = row
      .map((cell, c) => {
        const text = cellText(cell).replace(/\s+/g, " ").trim();
        return text ? `${columnLabel(model, c, words)}: ${text}` : null;
      })
      .filter(Boolean);
    if (cells.length > 0) parts.push(`${words.row(r + 1)}: ${cells.join("; ")}.`);
  });
  return parts.join(" ");
}

/** "Zeile 2 von 6": one TalkBack stop per row in the full view. */
export interface TableRowSpeechWords extends TableSpeechWords {
  rowOf: (n: number, total: number) => string;
}

export const GERMAN_TABLE_ROW_SPEECH: TableRowSpeechWords = {
  ...GERMAN_TABLE_SPEECH,
  rowOf: (n, total) => `Zeile ${n} von ${total}`,
};

/**
 * TalkBack text of one row in the full view (§3): "Zeile 2 von 6.
 * Teil: Tablet-Layout; Stand: fertig und veröffentlicht". `row` is 0-based
 * in `model.rows`. Empty cells are left out like in `tableToSpeech`.
 */
export function tableRowToSpeech(
  model: TableModel,
  row: number,
  words: TableRowSpeechWords = GERMAN_TABLE_ROW_SPEECH,
): string {
  const cells = (model.rows[row] ?? [])
    .map((cell, c) => {
      const text = cellText(cell).replace(/\s+/g, " ").trim();
      return text ? `${columnLabel(model, c, words)}: ${text}` : null;
    })
    .filter(Boolean);
  const head = words.rowOf(row + 1, model.rows.length);
  return cells.length > 0 ? `${head}. ${cells.join("; ")}` : head;
}

/** Link targets of one row, in reading order (TalkBack actions). */
export function rowLinks(model: TableModel, row: number): { text: string; href: string }[] {
  const out: { text: string; href: string }[] = [];
  for (const cell of model.rows[row] ?? []) {
    for (const run of cell) {
      if (!run.href) continue;
      const prev = out[out.length - 1];
      // Adjacent runs of one link (bold part + plain part) are one target.
      if (prev && prev.href === run.href) prev.text += run.text;
      else out.push({ text: run.text, href: run.href });
    }
  }
  return out.map((l) => ({ ...l, text: l.text.trim() || l.href }));
}

/**
 * Bubble / comment card actions that open a table in the full view
 * (§3): one action "Tabelle in Vollansicht öffnen", or with several
 * tables "Tabelle 1 öffnen", "Tabelle 2 öffnen" … `name` is what
 * `onAccessibilityAction` gets back; `tableIndexFromAction` reverses it.
 */
export const TABLE_ACTION_PREFIX = "open_table_";

export function tableOpenActions(
  count: number,
  words: { one: string; nth: (n: number) => string },
): { name: string; label: string }[] {
  if (count <= 0) return [];
  if (count === 1) return [{ name: `${TABLE_ACTION_PREFIX}0`, label: words.one }];
  return Array.from({ length: count }, (_, i) => ({
    name: `${TABLE_ACTION_PREFIX}${i}`,
    label: words.nth(i + 1),
  }));
}

export function tableIndexFromAction(name: string): number | null {
  if (!name.startsWith(TABLE_ACTION_PREFIX)) return null;
  const n = Number(name.slice(TABLE_ACTION_PREFIX.length));
  return Number.isInteger(n) && n >= 0 ? n : null;
}

/** Markdown source of a table (full view "Kopieren"). */
export function tableToMarkdown(model: TableModel): string {
  const cell = (c: InlineRun[]) =>
    c
      .map((r) => {
        let t = r.text.replace(/\|/g, "\\|").replace(/\n/g, "<br>");
        if (r.code) t = `\`${t}\``;
        if (r.bold) t = `**${t}**`;
        if (r.italic) t = `*${t}*`;
        if (r.strike) t = `~~${t}~~`;
        if (r.href) t = `[${t}](${r.href})`;
        return t;
      })
      .join("")
      .trim();
  const line = (cells: InlineRun[][]) => `| ${cells.map(cell).join(" | ")} |`;
  const sep = model.align.map((a) =>
    a === "center" ? ":---:" : a === "right" ? "---:" : a === "left" ? ":---" : "---",
  );
  return [line(model.header), `| ${sep.join(" | ")} |`, ...model.rows.map(line)].join("\n");
}
