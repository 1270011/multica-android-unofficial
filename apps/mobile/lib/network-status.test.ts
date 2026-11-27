/**
 * Tests for the app-wide connectivity signal (lib/network-status.ts):
 * the pure "what does offline mean" rule, the observed-reachability
 * flips (markNetworkOnline / markNetworkOffline), and the probe loop
 * that clears the offline state as soon as the server answers.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { onlineManager } from "@tanstack/react-query";
import {
  isNetworkOffline,
  markNetworkOffline,
  markNetworkOnline,
  setNetworkProbeUrl,
  useNetworkStore,
} from "./network-status";

const online = () => useNetworkStore.getState().online;

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  setNetworkProbeUrl(null);
  useNetworkStore.setState({ online: true });
});

describe("isNetworkOffline", () => {
  it("counts a disconnected radio as offline", () => {
    expect(isNetworkOffline({ isConnected: false, isInternetReachable: null })).toBe(true);
  });

  it("counts connected-without-internet as offline", () => {
    expect(isNetworkOffline({ isConnected: true, isInternetReachable: false })).toBe(true);
  });

  it("counts unknown reachability (still probing) as online", () => {
    expect(isNetworkOffline({ isConnected: true, isInternetReachable: null })).toBe(false);
    expect(isNetworkOffline({ isConnected: true, isInternetReachable: true })).toBe(false);
  });
});

describe("observed reachability", () => {
  it("flips offline on a connection-level failure and back on success", () => {
    markNetworkOffline();
    expect(online()).toBe(false);
    markNetworkOnline();
    expect(online()).toBe(true);
  });

  it("does not touch TanStack Query on the way down", () => {
    const setOnline = vi.spyOn(onlineManager, "setOnline");
    markNetworkOffline();
    expect(setOnline).not.toHaveBeenCalled();
    markNetworkOnline();
    expect(setOnline).toHaveBeenLastCalledWith(true);
  });

  it("clears the offline state as soon as a probe answers", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("ok")));
    setNetworkProbeUrl("https://server.example");
    markNetworkOffline();
    expect(online()).toBe(false);
    await vi.waitFor(() => expect(online()).toBe(true));
  });

  it("retries the probe while offline until the server answers", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn<() => Promise<Response>>(async () => {
      throw new TypeError("Network request failed");
    });
    vi.stubGlobal("fetch", fetchMock);
    setNetworkProbeUrl("https://server.example");
    markNetworkOffline();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(online()).toBe(false);
    await vi.advanceTimersByTimeAsync(11_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(online()).toBe(false);
    fetchMock.mockImplementation(async () => new Response("ok"));
    await vi.advanceTimersByTimeAsync(11_000);
    expect(online()).toBe(true);
  });
});
