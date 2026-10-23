/**
 * Mobile-owned parseWithFallback. Mirrors packages/core/api/schema.ts —
 * the boundary defense for installed-app schema drift required by root
 * CLAUDE.md "API Response Compatibility" and apps/mobile/CLAUDE.md
 * "Type drift defense".
 *
 * Why we mirror instead of import: keeps mobile fully decoupled and lets
 * us route the warning into mobile's own logger instead of the core
 * schemaLogger singleton. Behavior: safeParse → on success return parsed;
 * on failure log + return fallback (never throw into UI).
 *
 * The warning carries only the endpoint and each issue's path and code —
 * never the response itself: a drifted
 * `/api/auth/refresh` body would otherwise put a fresh JWT into logcat.
 */
import { type ZodType } from "zod";
import { logger } from "./logger";

export interface ParseOptions {
  endpoint: string;
}

/** Issue summary that is safe to log: where it failed and why, no values. */
export function describeIssues(
  issues: readonly { path: readonly PropertyKey[]; code: string }[],
): { path: string; code: string }[] {
  return issues.slice(0, 10).map((issue) => ({
    path: issue.path.map(String).join("."),
    code: issue.code,
  }));
}

export function parseWithFallback<T>(
  data: unknown,
  schema: ZodType,
  fallback: T,
  opts: ParseOptions,
): T {
  const result = schema.safeParse(data);
  if (result.success) return result.data as T;
  logger.warn(`[api] schema validation failed: ${opts.endpoint}`, {
    issues: describeIssues(result.error.issues),
  });
  return fallback;
}

export interface ChunkedParseOptions extends ParseOptions {
  signal?: AbortSignal;
  /** Entries per block at most (default 100). */
  chunkSize?: number;
  /** A block also ends once it has run this long (default 8 ms), so slow
   *  entries (big activity details, many attachments) cannot stretch it. */
  budgetMs?: number;
}

const now: () => number =
  typeof performance !== "undefined" && typeof performance.now === "function"
    ? () => performance.now()
    : () => Date.now();

const yieldToEventLoop = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/**
 * Array variant of parseWithFallback for big list bodies. One `z.array(entry).safeParse` over a 1.3 MB timeline blocked
 * the JS thread for ~234 ms in one go — no back gesture, no skeleton frame.
 * Here every entry is checked on its own with the same entry schema and the
 * work is split into short blocks with a macrotask yield in between.
 *
 * - Not an array at all → warning + fallback, exactly like parseWithFallback.
 * - A malformed entry is dropped on its own instead of emptying the whole
 *   list; one warning per call carries the count plus index/path/code of the
 *   first issues — never the entry itself (same rule as describeIssues).
 * - An aborted signal stops between blocks (TanStack already discarded the
 *   result) and rejects with the signal's reason.
 */
export async function parseArrayInChunks<T>(
  data: unknown,
  entrySchema: ZodType,
  fallback: T[],
  opts: ChunkedParseOptions,
): Promise<T[]> {
  if (!Array.isArray(data)) {
    logger.warn(`[api] schema validation failed: ${opts.endpoint}`, {
      issues: [{ path: "", code: "invalid_type" }],
    });
    return fallback;
  }
  const chunkSize = Math.max(1, opts.chunkSize ?? 100);
  const budgetMs = opts.budgetMs ?? 8;
  const out: T[] = [];
  const issues: { path: string; code: string }[] = [];
  let dropped = 0;
  let blockStart = now();
  let inBlock = 0;
  for (let i = 0; i < data.length; i++) {
    if (inBlock >= chunkSize || now() - blockStart >= budgetMs) {
      await yieldToEventLoop();
      throwIfAborted(opts.signal);
      blockStart = now();
      inBlock = 0;
    }
    const result = entrySchema.safeParse(data[i]);
    inBlock++;
    if (result.success) {
      out.push(result.data as T);
      continue;
    }
    dropped++;
    if (issues.length < 10) {
      for (const issue of describeIssues(result.error.issues)) {
        issues.push({ path: issue.path ? `${i}.${issue.path}` : String(i), code: issue.code });
      }
    }
  }
  if (dropped > 0) {
    logger.warn(`[api] schema validation failed: ${opts.endpoint}`, {
      dropped,
      total: data.length,
      issues: issues.slice(0, 10),
    });
  }
  return out;
}

function throwIfAborted(signal: AbortSignal | undefined) {
  if (!signal?.aborted) return;
  throw signal.reason ?? new Error("Aborted");
}
