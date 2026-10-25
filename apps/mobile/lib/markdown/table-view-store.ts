/**
 * Hands a table from a bubble / comment card to the full view route
 *. The route gets a short key instead of the whole table in the
 * URL; the model stays here. Bounded, so a long session that opens many
 * tables does not keep them all. After a JS restart (route restore) the key
 * is unknown and the screen says so instead of showing an empty grid.
 *
 * Kept free of React / RN imports so vitest can cover it.
 */
import { perfMark } from "../perf-mark";
import type { TableModel } from "./table-model";

export const TABLE_VIEW_STORE_MAX = 8;

const tables = new Map<string, TableModel>();
let next = 0;

/** Stores `table` and returns the key for `table-view?key=…`. */
export function putTableForView(table: TableModel): string {
  for (const [key, t] of tables) {
    // The same table opened again (bubble re-rendered or opened twice):
    // reuse its key and mark it as the newest.
    if (t === table) {
      tables.delete(key);
      tables.set(key, table);
      return key;
    }
  }
  const key = `t${++next}`;
  tables.set(key, table);
  while (tables.size > TABLE_VIEW_STORE_MAX) {
    const oldest = tables.keys().next().value as string;
    tables.delete(oldest);
  }
  return key;
}

export function getTableForView(key: string | undefined): TableModel | undefined {
  return key ? tables.get(key) : undefined;
}

/**
 * Chat position after the full view (criterion 14). The chat list
 * stays mounted under the full view and keeps its offset, but a rotation
 * while the full view is open re-lays out every bubble, and at large font
 * scales the list lands elsewhere. The bubble and the table that opened the
 * full view are remembered here; the chat scrolls back to that table on
 * focus, only after a rotation. Landing on the bubble's top was not enough:
 * at 200 % the table can sit screens below it.
 */
export interface TableViewReturn {
  entryId: string;
  table: TableModel | null;
  /** Window y of the table's top when it was opened, if it was drawn. */
  screenTop: number | null;
  /** The bubble's row in the chat list when it was opened (`RowPlace`). */
  row: RowPlace | null;
}

/** A chat row on screen from the list's own layout, not from the window:
 *  top relative to the list's viewport and height. After a rotation with
 *  the full view on top, `measureInWindow` reported the table 107.8 dp
 *  lower at 100 % than it stood, and the return scrolled by that much
 * . The list layout is what the screen shows. */
export interface RowPlace {
  top: number;
  height: number;
}

/** Mounted chat lists answer where a comment's row sits (`RowPlace`), or
 *  null if it is not theirs / not laid out. */
type RowProbe = (entryId: string) => RowPlace | null;
const rowProbes = new Set<RowProbe>();

export function registerTableRowProbe(probe: RowProbe): () => void {
  rowProbes.add(probe);
  return () => {
    rowProbes.delete(probe);
  };
}

export function probeTableRow(entryId: string): RowPlace | null {
  for (const probe of rowProbes) {
    const row = probe(entryId);
    if (row) return row;
  }
  return null;
}

let returnTo: (TableViewReturn & { rotated: boolean }) | null = null;

export function setTableViewOrigin(entryId: string | undefined, table?: TableModel): void {
  returnTo = entryId
    ? { entryId, table: table ?? null, screenTop: null, row: probeTableRow(entryId), rotated: false }
    : null;
  const node = entryId ? getTableNode(table, entryId) : undefined;
  const r = returnTo;
  perfMark(`table:origin node=${node ? "yes" : "no"} row=${returnTo?.row?.top}/${returnTo?.row?.height}`);
  node?.measureInWindow((_x, y, _w, h) => {
    perfMark(`table:origin y=${y} h=${h}`);
    if (r && returnTo === r && h > 0) r.screenTop = y;
  });
}

export function markTableViewRotated(): void {
  if (returnTo) returnTo.rotated = true;
}

/** Bubble and table to scroll back to, once, when the device was turned. */
export function takeTableViewReturn(): TableViewReturn | null {
  const r = returnTo;
  returnTo = null;
  return r?.rotated ? { entryId: r.entryId, table: r.table, screenTop: r.screenTop, row: r.row } : null;
}

/** What the chat needs from a mounted table view: its place on screen. */
export interface MeasurableNode {
  measureInWindow(cb: (x: number, y: number, width: number, height: number) => void): void;
}

interface DrawnTable {
  node: MeasurableNode;
  entryId: string | undefined;
}

/** Every drawn copy of a table, newest last. One table model can be drawn
 *  several times at once: the landing cover over the chat, a recycled cell,
 *  the comment card in the activity. With one slot per table, the copy that
 *  unmounted last took the chat's entry with it, so opening the table at
 *  200 % found no node and the chat landed on the table's top. */
const nodes = new Map<TableModel, DrawnTable[]>();

/**
 * A drawn table announces its view, so the chat can measure where it sits
 * inside its bubble after a rotation; `entryId` is the comment it belongs to
 * (undefined outside the chat). Returns the unregister function, which
 * removes only this copy.
 */
export function registerTableNode(
  table: TableModel,
  node: MeasurableNode,
  entryId?: string,
): () => void {
  const drawn: DrawnTable = { node, entryId };
  nodes.set(table, [...(nodes.get(table) ?? []), drawn]);
  return () => {
    const rest = (nodes.get(table) ?? []).filter((d) => d !== drawn);
    if (rest.length) nodes.set(table, rest);
    else nodes.delete(table);
  };
}

/** The newest drawn copy of `table`; with `entryId`, the newest one in that
 *  comment's bubble (a comment card elsewhere sits at another place). */
export function getTableNode(
  table: TableModel | null | undefined,
  entryId?: string,
): MeasurableNode | undefined {
  const list = table ? nodes.get(table) : undefined;
  if (!list) return undefined;
  for (let i = list.length - 1; i >= 0; i--) {
    if (entryId === undefined || list[i].entryId === entryId) return list[i].node;
  }
  return undefined;
}
