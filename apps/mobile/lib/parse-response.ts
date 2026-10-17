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
