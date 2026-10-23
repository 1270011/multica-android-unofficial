import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@react-native-community/netinfo", () => ({
  default: { addEventListener: vi.fn(() => () => {}) },
}));

import { isNetworkOffline, runWhileOnline, useNetworkStore } from "./network-status";
import { viewUpdateErrorKind } from "./issue-view-edit";

describe("isNetworkOffline", () => {
  it("is offline when not connected", () => {
    expect(isNetworkOffline({ isConnected: false, isInternetReachable: null })).toBe(true);
  });
  it("is offline when connected but internet is known unreachable", () => {
    expect(isNetworkOffline({ isConnected: true, isInternetReachable: false })).toBe(true);
  });
  it("is online while reachability is still unknown", () => {
    expect(isNetworkOffline({ isConnected: true, isInternetReachable: null })).toBe(false);
    expect(isNetworkOffline({ isConnected: null, isInternetReachable: null })).toBe(false);
  });
  it("is online when connected and reachable", () => {
    expect(isNetworkOffline({ isConnected: true, isInternetReachable: true })).toBe(false);
  });
});

describe("useNetworkStore", () => {
  it("defaults to online so the banner never flashes on boot", () => {
    expect(useNetworkStore.getState().online).toBe(true);
  });
});

describe("runWhileOnline (saving a view)", () => {
  const setOnline = (online: boolean) => useNetworkStore.setState({ online });
  afterEach(() => setOnline(true));

  it("does not start the write while offline", async () => {
    setOnline(false);
    const run = vi.fn(() => Promise.resolve("saved"));
    const err = await runWhileOnline(run).catch((e: unknown) => e);
    expect(run).not.toHaveBeenCalled();
    expect(viewUpdateErrorKind(err)).toBe("offline");
  });

  it("gives up on a hanging request when the link drops, then saves after reconnect", async () => {
    const hanging = runWhileOnline(() => new Promise<string>(() => {}));
    setOnline(false);
    expect(viewUpdateErrorKind(await hanging.catch((e: unknown) => e))).toBe("offline");

    setOnline(true);
    await expect(runWhileOnline(() => Promise.resolve("saved"))).resolves.toBe("saved");
  });

  it("passes a 409 after reconnect through to the conflict dialog", async () => {
    setOnline(false);
    setOnline(true);
    const conflict = Object.assign(new Error("view was modified by someone else"), {
      status: 409,
    });
    const err = await runWhileOnline(() => Promise.reject(conflict)).catch((e: unknown) => e);
    expect(viewUpdateErrorKind(err)).toBe("conflict");
  });
});
