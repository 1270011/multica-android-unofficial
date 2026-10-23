/**
 * Pure model for top-level GFM tables.
 *
 * enriched-markdown draws tables natively with its own HorizontalScrollView,
 * but inside the chat / comment bubbles (RN `Pressable` with onLongPress) the
 * horizontal swipe never scrolls it: the cells' native long-click opens the
 * library's copy popup instead, and wide tables stay clipped after 1.5
 * columns. The splitter therefore lifts top-level tables out of the prose
 * stream (like fenced code) and `MarkdownTable` renders them in an RN
 * horizontal `ScrollView`, whose responder cleanly cancels the bubble's
 * long-press once the finger moves.
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
 * Column sizing without a measure pass: one deterministic estimate per table
 * (computed once per comment, no onLayout round-trips while a long chat
 * scrolls).
 *
 * Each column gets its widest cell's text width, clamped to
 * [min, max]. Longer text wraps inside the cell; a single long token (a
 * path such as `/var/log/app`) widens the column up to `max` before it has
 * to break. Values are in dp at font scale 1 — the renderer multiplies by
 * the current font scale.
 */
export const TABLE_CELL_PADDING_H = 10;
export const TABLE_CELL_PADDING_V = 6;
export const TABLE_COL_MIN = 64;
export const TABLE_COL_MAX = 240;
// Average advance of the 14 sp body font / monospace on Android, in dp.
const CHAR_W = 7.4;
const CODE_CHAR_W = 8.4;

function runWidth(cell: InlineRun[]): number {
  let longestLine = 0;
  let line = 0;
  for (const run of cell) {
    const w = run.code ? CODE_CHAR_W : run.bold ? CHAR_W * 1.06 : CHAR_W;
    const parts = run.text.split("\n");
    parts.forEach((p, i) => {
      if (i > 0) {
        longestLine = Math.max(longestLine, line);
        line = 0;
      }
      line += [...p].length * w;
    });
  }
  return Math.max(longestLine, line);
}

export function estimateColumnWidths(model: TableModel): number[] {
  const rows = [model.header, ...model.rows];
  return model.align.map((_, col) => {
    let text = 0;
    for (const row of rows) text = Math.max(text, runWidth(row[col] ?? []));
    const w = Math.ceil(text) + TABLE_CELL_PADDING_H * 2 + 2;
    return Math.min(TABLE_COL_MAX, Math.max(TABLE_COL_MIN, w));
  });
}
