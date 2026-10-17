import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "./api";

// A refresh response that fails the schema must
// not put the new session token into the log (parseWithFallback used to log
// the whole body as `received`).
vi.mock("@/data/server-config-store", () => ({
  getServerBaseUrl: () => "https://api.example.test",
  getCfAccessHeaders: () => ({ "CF-Access-Client-Secret": "cf-secret-value-1234" }),
}));
vi.mock("@/lib/client-os", () => ({ CLIENT_OS: "android" }));
vi.mock("@/data/workspace-store", () => ({ getCurrentSlug: () => null }));

const JWT = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0LXVzZXIifQ.c2lnbmF0dXJlLXRlc3Q";

describe("refreshSession logging", () => {
  const sinks = {
    log: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };

  beforeEach(() => {
    for (const [name, fn] of Object.entries(sinks)) {
      fn.mockReset();
      vi.spyOn(console, name as keyof typeof sinks).mockImplementation(fn);
    }
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("falls back without logging the token from a drifted body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({ token: JWT, renewed: true, check_again_in_seconds: -5 }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );
    api.setToken(JWT);

    const res = await api.refreshSession();

    expect(res.renewed).toBe(false);
    expect(sinks.warn).toHaveBeenCalled();
    const everything = JSON.stringify(Object.values(sinks).flatMap((s) => s.mock.calls));
    expect(everything).toContain("schema validation failed");
    expect(everything).toContain("check_again_in_seconds");
    expect(everything).not.toContain(JWT);
    expect(everything).not.toContain("cf-secret-value-1234");
    api.setToken(null);
  });

  it("does not log the token from an error body either", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ message: `expired ${JWT}` }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    await expect(api.refreshSession()).rejects.toThrow();
    const everything = JSON.stringify(Object.values(sinks).flatMap((s) => s.mock.calls));
    expect(everything).not.toContain(JWT);
  });
});
