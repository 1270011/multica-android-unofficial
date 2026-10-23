/**
 * Module-wide LRU cache `content → segments` in front of
 * `splitMarkdown(preprocessMobileMarkdown(content))`.
 *
 * `<Markdown>` used to memoise the split per component instance. FlashList
 * recycles cells, so a recycled cell that gets another comment lost its
 * memo and ran `marked.lexer` again: ~9 ms per comment (jitless median),
 * more for long ones, 10–30 ms JS per frame while scrolling fast. This
 * cache lives outside React, so it survives recycling and reopening an
 * issue in the same process.
 *
 * Key: the raw content string itself (Map key = exact string equality).
 * No hash, so no collision can ever show another comment's text; any edit
 * is a different string and therefore a new entry.
 *
 * Bounds: at most MAX_ENTRIES entries and MAX_CHARS characters of keys in
 * total; the least recently used entries are evicted first. Content longer
 * than MAX_ENTRY_CHARS is split but not cached. Memory only, nothing is
 * persisted on the device. Cleared when a session ends (session-end.ts)
 * and on a workspace switch (workspace-store.ts).
 *
 * The returned arrays are shared between all callers with the same
 * content: treat them as read-only.
 */
import { preprocessMobileMarkdown } from "./preprocess";
import { splitMarkdown, type MarkdownSegment } from "./split-markdown";

export const MAX_ENTRIES = 500;
export const MAX_CHARS = 2_000_000;
export const MAX_ENTRY_CHARS = 200_000;

// Map keeps insertion order: the first key is the least recently used.
const cache = new Map<string, MarkdownSegment[]>();
let totalChars = 0;

function computeSegments(content: string): MarkdownSegment[] {
  return splitMarkdown(preprocessMobileMarkdown(content));
}

/** Segments for `content`, from the cache when the same text was split before. */
export function getMarkdownSegments(content: string): MarkdownSegment[] {
  const hit = cache.get(content);
  if (hit) {
    // Move to the most recently used end.
    cache.delete(content);
    cache.set(content, hit);
    return hit;
  }

  const segments = computeSegments(content);
  if (content.length > MAX_ENTRY_CHARS) return segments;

  cache.set(content, segments);
  totalChars += content.length;
  while (cache.size > MAX_ENTRIES || totalChars > MAX_CHARS) {
    const oldest = cache.keys().next().value as string;
    cache.delete(oldest);
    totalChars -= oldest.length;
  }
  return segments;
}

/** Drop every cached split (logout, session end, workspace switch). */
export function clearMarkdownSegmentCache(): void {
  cache.clear();
  totalChars = 0;
}

/** Test hook: current entry count and key size. */
export function markdownSegmentCacheStats(): { entries: number; chars: number } {
  return { entries: cache.size, chars: totalChars };
}
