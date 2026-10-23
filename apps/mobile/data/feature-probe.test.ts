import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError, api } from "./api";
import { featureState } from "@/lib/ai-team";

vi.mock("react-native", () => ({ useWindowDimensions: () => ({ width: 0, height: 0 }) }));

// See api.test.ts: stub the native-backed stores the client reads per request.
vi.mock("@/data/server-config-store", () => ({
  getServerBaseUrl: () => "https://api.example.test",
  getCfAccessHeaders: () => ({}),
}));
vi.mock("@/lib/client-os", () => ({ CLIENT_OS: "android" }));
vi.mock("@/data/workspace-store", () => ({ getCurrentSlug: () => "ws" }));

const fetchMock = vi.fn<(url: string, init: RequestInit) => Promise<Response>>();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("probeAutopilots (AI Team feature gate)", () => {
  it("asks for one autopilot and resolves on 200, whatever the body", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ unexpected: true }), { status: 200 }));
    await expect(api.probeAutopilots()).resolves.toBe(true);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://api.example.test/api/autopilots?limit=1");
  });
  it("a 404 rejects with ApiError and gates the feature off", async () => {
    fetchMock.mockResolvedValue(new Response("404 page not found", { status: 404 }));
    const err = await api.probeAutopilots().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(featureState({ isSuccess: false, error: err })).toBe("missing");
  });
  it("a 500 keeps the entry (unknown, not missing)", async () => {
    fetchMock.mockResolvedValue(new Response("boom", { status: 500 }));
    const err = await api.probeAutopilots().catch((e: unknown) => e);
    expect(featureState({ isSuccess: false, error: err })).toBe("unknown");
  });
});
