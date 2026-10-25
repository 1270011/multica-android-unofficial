/**
 * CPU-time budget for the A5.9 speed tests (title filter on 1000 issues).
 *
 * Wall time failed under the full parallel suite on a loaded host (8.9 ms for
 * a 1 ms job); CPU time leaves out the wait for a core. A single best-of-five
 * still went red in CI (5.5–5.7 ms against 5 ms): the runner
 * measures with v8 coverage and `nice`, and the first passes include JIT and
 * GC. So: warm-up passes first, then the fastest of several passes, and a
 * looser bound when `CI` is set. A real slowdown (e.g. a regex per issue
 * instead of the cached matcher) still fails both bounds.
 */

/** Budget in ms: `localMs` on a dev machine, `ciMs` when `CI` is set. */
export function cpuBudgetMs(localMs: number, ciMs: number, env: Record<string, string | undefined> = process.env): number {
  const ci = env.CI;
  return ci && ci !== "0" && ci !== "false" ? ciMs : localMs;
}

/** CPU milliseconds of `job`: `warmup` untimed passes, then the fastest of `runs`. */
export function minCpuMs(
  job: () => void,
  { warmup = 3, runs = 9, cpuUsage = process.cpuUsage }: { warmup?: number; runs?: number; cpuUsage?: typeof process.cpuUsage } = {},
): number {
  for (let pass = 0; pass < warmup; pass++) job();
  let best = Infinity;
  for (let run = 0; run < runs; run++) {
    const start = cpuUsage();
    job();
    const used = cpuUsage(start);
    best = Math.min(best, (used.user + used.system) / 1000);
  }
  return best;
}
