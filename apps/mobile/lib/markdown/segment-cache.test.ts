// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const spy = vi.hoisted(() => ({ calls: 0 }));
vi.mock("./split-markdown", async (importOriginal) => {
  const real = await importOriginal<typeof import("./split-markdown")>();
  return {
    ...real,
    splitMarkdown: (input: string) => {
      spy.calls++;
      return real.splitMarkdown(input);
    },
  };
});

import { preprocessMobileMarkdown } from "./preprocess";
import { splitMarkdown } from "./split-markdown";
import {
  MAX_CHARS,
  MAX_ENTRIES,
  MAX_ENTRY_CHARS,
  clearMarkdownSegmentCache,
  getMarkdownSegments,
  markdownSegmentCacheStats,
} from "./segment-cache";

const SAMPLE = [
  "# Titel",
  "",
  "Text mit **fett** und [Link](https://example.com).",
  "",
  "```ts",
  "const a = 1;",
  "```",
  "",
  "| A | B |",
  "|---|---|",
  "| 1 | 2 |",
  "",
  "![Bild](https://example.com/a.png)",
].join("\n");

beforeEach(() => {
  clearMarkdownSegmentCache();
  spy.calls = 0;
});

describe("markdown segment cache", () => {
  it("returns the same segments as the uncached split", () => {
    const expected = splitMarkdown(preprocessMobileMarkdown(SAMPLE));
    expect(getMarkdownSegments(SAMPLE)).toEqual(expected);
    expect(getMarkdownSegments(SAMPLE)).toEqual(expected);
    expect(getMarkdownSegments("")).toEqual([]);
  });

  it("splits the same content only once (second call is a hit)", () => {
    const first = getMarkdownSegments(SAMPLE);
    spy.calls = 0;
    const second = getMarkdownSegments(SAMPLE);
    expect(spy.calls).toBe(0);
    expect(second).toBe(first);
  });

  it("an edited comment gets a fresh result", () => {
    const before = getMarkdownSegments("alt");
    const after = getMarkdownSegments("alt!");
    expect(after).not.toBe(before);
    expect(after).toEqual([{ type: "prose", content: "alt!" }]);
    expect(getMarkdownSegments("alt")).toEqual([{ type: "prose", content: "alt" }]);
  });

  it("keeps at most MAX_ENTRIES and evicts the least recently used", () => {
    for (let i = 0; i < MAX_ENTRIES; i++) getMarkdownSegments(`c${i}`);
    // Touch c0 so c1 becomes the oldest.
    getMarkdownSegments("c0");
    getMarkdownSegments("neu");
    expect(markdownSegmentCacheStats().entries).toBe(MAX_ENTRIES);

    spy.calls = 0;
    getMarkdownSegments("c0");
    expect(spy.calls).toBe(0);
    getMarkdownSegments("c1");
    expect(spy.calls).toBe(1);
  });

  it("bounds the total size and skips huge entries", () => {
    const big = "x".repeat(MAX_ENTRY_CHARS);
    const count = Math.floor(MAX_CHARS / MAX_ENTRY_CHARS) + 2;
    for (let i = 0; i < count; i++) getMarkdownSegments(`${i}${big}`);
    expect(markdownSegmentCacheStats().chars).toBeLessThanOrEqual(MAX_CHARS);

    clearMarkdownSegmentCache();
    getMarkdownSegments("y".repeat(MAX_ENTRY_CHARS + 1));
    expect(markdownSegmentCacheStats()).toEqual({ entries: 0, chars: 0 });
  });

  it("clear drops every entry", () => {
    getMarkdownSegments(SAMPLE);
    clearMarkdownSegmentCache();
    expect(markdownSegmentCacheStats()).toEqual({ entries: 0, chars: 0 });
    spy.calls = 0;
    getMarkdownSegments(SAMPLE);
    expect(spy.calls).toBe(1);
  });

  it("a hit is much cheaper than the split", () => {
    const long = Array.from({ length: 40 }, () => SAMPLE).join("\n\n");
    const t0 = performance.now();
    getMarkdownSegments(long);
    const miss = performance.now() - t0;
    const t1 = performance.now();
    for (let i = 0; i < 100; i++) getMarkdownSegments(long);
    const hit = (performance.now() - t1) / 100;
    expect(hit).toBeLessThan(miss / 10);
  });
});
