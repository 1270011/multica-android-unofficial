import { describe, expect, it } from "vitest";
import { cpuBudgetMs, minCpuMs } from "./cpu-budget";

describe("cpuBudgetMs", () => {
  it("uses the CI bound only when CI is set", () => {
    expect(cpuBudgetMs(5, 10, {})).toBe(5);
    expect(cpuBudgetMs(5, 10, { CI: "" })).toBe(5);
    expect(cpuBudgetMs(5, 10, { CI: "0" })).toBe(5);
    expect(cpuBudgetMs(5, 10, { CI: "false" })).toBe(5);
    expect(cpuBudgetMs(5, 10, { CI: "1" })).toBe(10);
    expect(cpuBudgetMs(5, 10, { CI: "true" })).toBe(10);
  });
});

describe("minCpuMs", () => {
  it("runs the warm-up untimed and returns the fastest timed pass", () => {
    // Fake clock: each timed pass costs the next value (µs), warm-up costs nothing.
    const costs = [9000, 2000, 7000];
    let calls = 0;
    let timed = 0;
    const cpuUsage = ((start?: NodeJS.CpuUsage) => {
      if (!start) return { user: 0, system: 0 };
      return { user: costs[timed++], system: 0 };
    }) as typeof process.cpuUsage;
    const ms = minCpuMs(() => { calls++; }, { warmup: 2, runs: 3, cpuUsage });
    expect(calls).toBe(5);
    expect(timed).toBe(3);
    expect(ms).toBe(2);
  });

  it("measures real CPU time by default", () => {
    const ms = minCpuMs(() => {
      let x = 0;
      for (let i = 0; i < 1e5; i++) x += i;
      expect(x).toBeGreaterThan(0);
    }, { warmup: 1, runs: 2 });
    expect(ms).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(ms)).toBe(true);
  });
});
