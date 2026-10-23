import { afterEach, describe, expect, it, vi } from "vitest";
import type { ZodType } from "zod";
import { TimelineEntriesSchema } from "@multica/core/api/schemas";

import { logger } from "./logger";
import { parseArrayInChunks } from "./parse-response";

// The timeline is validated entry by entry in
// short blocks instead of one blocking array parse.

const ENTRY = TimelineEntriesSchema.element;
const OPTS = { endpoint: "GET /api/issues/:id/timeline" };

/** Timeline shaped like a long agent issue: comments with reactions,
 *  attachments and supplement receipts, plus activities with details. */
function bigTimeline(n: number): Record<string, unknown>[] {
  return Array.from({ length: n }, (_, i) => {
    const base = {
      id: `e-${i}`,
      actor_type: i % 3 ? "agent" : "member",
      actor_id: `a-${i % 7}`,
      created_at: new Date(Date.UTC(2026, 9, 1, 0, i)).toISOString(),
    };
    if (i % 4 === 0) {
      return {
        ...base,
        type: "activity",
        action: "status_changed",
        details: { from: "todo", to: "in_progress", nested: { k: [i, i + 1] } },
      };
    }
    return {
      ...base,
      type: "comment",
      content: `Kommentar ${i} `.repeat(20),
      parent_id: i % 5 ? null : `e-${i - 1}`,
      updated_at: base.created_at,
      revision: 1,
      comment_type: "comment",
      reactions: i % 6 ? [] : [
        { id: `r-${i}`, comment_id: `e-${i}`, actor_type: "member", actor_id: "m", emoji: "👍", created_at: base.created_at },
      ],
      attachments: i % 9 ? [] : [{ id: `att-${i}`, filename: "x.png", extra: true }],
      supplements: i % 10 ? undefined : [
        { task_id: "t1", status: "delivered" },
        { task_id: "t2", status: "bogus" },
      ],
      supplement_status: i % 11 ? undefined : "weird",
      deleted_at: i % 13 ? null : 42,
      unknown_server_field: i,
    };
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("parseArrayInChunks", () => {
  it("returns exactly what the one-shot array parse returned", async () => {
    const raw = bigTimeline(1300);
    const before = TimelineEntriesSchema.parse(structuredClone(raw));

    const after = await parseArrayInChunks(structuredClone(raw), ENTRY, [], OPTS);

    expect(after).toEqual(before);
    expect(after).toHaveLength(1300);
  });

  it("drops only malformed entries and logs where, never what", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
    const raw = bigTimeline(1200);
    const broken = new Set([3, 400, 1199]);
    raw[3] = { ...raw[3], id: 17 };
    raw[400] = { ...raw[400], created_at: undefined, content: "geheimer Inhalt" };
    raw[1199] = "not an entry" as unknown as Record<string, unknown>;
    const expected = TimelineEntriesSchema.parse(raw.filter((_, i) => !broken.has(i)));

    const out = await parseArrayInChunks(raw, ENTRY, [], OPTS);

    expect(out).toEqual(expected);
    expect(warn).toHaveBeenCalledTimes(1);
    const [msg, meta] = warn.mock.calls[0]!;
    expect(msg).toBe("[api] schema validation failed: GET /api/issues/:id/timeline");
    expect(meta).toMatchObject({ dropped: 3, total: 1200 });
    const paths = (meta as { issues: { path: string }[] }).issues.map((x) => x.path);
    expect(paths).toEqual(["3.id", "400.created_at", "1199"]);
    expect(JSON.stringify(warn.mock.calls)).not.toContain("geheimer Inhalt");
  });

  it("falls back like parseWithFallback when the body is not an array", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
    const fallback: never[] = [];

    expect(await parseArrayInChunks({ entries: [] }, ENTRY, fallback, OPTS)).toBe(fallback);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("does not warn for a clean list", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
    await parseArrayInChunks(bigTimeline(50), ENTRY, [], OPTS);
    expect(warn).not.toHaveBeenCalled();
  });

  it("yields to the event loop after at most chunkSize entries", async () => {
    const log: string[] = [];
    const spy = {
      safeParse: (v: unknown) => {
        log.push("p");
        return { success: true, data: v };
      },
    } as unknown as ZodType;
    const realSetTimeout = globalThis.setTimeout;
    vi.spyOn(globalThis, "setTimeout").mockImplementation(((fn: () => void, ms?: number) => {
      log.push("|");
      return realSetTimeout(fn, ms);
    }) as typeof setTimeout);

    const out = await parseArrayInChunks(Array.from({ length: 250 }, (_, i) => i), spy, [], {
      ...OPTS,
      chunkSize: 100,
      budgetMs: 1e9,
    });

    expect(out).toHaveLength(250);
    const blocks = log.join("").split("|").map((b) => b.length);
    expect(blocks).toEqual([100, 100, 50]);
  });

  it("ends a block once its time budget is used up", async () => {
    // Fake clock: every entry costs 2 ms, so wall-clock noise on a loaded
    // host cannot make this flaky.
    let clock = 0;
    vi.spyOn(performance, "now").mockImplementation(() => clock);
    const log: string[] = [];
    const slow = {
      safeParse: (v: unknown) => {
        clock += 2;
        log.push("p");
        return { success: true, data: v };
      },
    } as unknown as ZodType;
    const realSetTimeout = globalThis.setTimeout;
    vi.spyOn(globalThis, "setTimeout").mockImplementation(((fn: () => void, ms?: number) => {
      log.push("|");
      return realSetTimeout(fn, ms);
    }) as typeof setTimeout);

    await parseArrayInChunks(Array.from({ length: 40 }, (_, i) => i), slow, [], {
      ...OPTS,
      budgetMs: 8,
    });

    const blocks = log.join("").split("|").map((b) => b.length);
    expect(blocks).toEqual(Array(10).fill(4));
  });

  it("stops between blocks once the query is aborted", async () => {
    const ctrl = new AbortController();
    let parsed = 0;
    const spy = {
      safeParse: (v: unknown) => {
        if (++parsed === 100) ctrl.abort(new Error("cancelled"));
        return { success: true, data: v };
      },
    } as unknown as ZodType;

    await expect(
      parseArrayInChunks(Array.from({ length: 500 }, (_, i) => i), spy, [], {
        ...OPTS,
        chunkSize: 100,
        signal: ctrl.signal,
      }),
    ).rejects.toThrow("cancelled");
    expect(parsed).toBe(100);
  });
});
