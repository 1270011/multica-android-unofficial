import { describe, expect, it, vi } from "vitest";
import { lazyModule } from "./lazy-module";

describe("lazyModule", () => {
  it("does not load before the first call", () => {
    const load = vi.fn(() => ({ ok: true }));
    lazyModule(load);
    expect(load).not.toHaveBeenCalled();
  });

  it("loads once and returns the same module afterwards", () => {
    const mod = { ok: true };
    const load = vi.fn(() => mod);
    const get = lazyModule(load);
    expect(get()).toBe(mod);
    expect(get()).toBe(mod);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("caches falsy modules too", () => {
    const load = vi.fn(() => undefined);
    const get = lazyModule(load);
    get();
    get();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("retries after a failed load", () => {
    const load = vi.fn<() => string>().mockImplementationOnce(() => {
      throw new Error("native module missing");
    }).mockReturnValue("mod");
    const get = lazyModule(load);
    expect(() => get()).toThrow("native module missing");
    expect(get()).toBe("mod");
  });
});
