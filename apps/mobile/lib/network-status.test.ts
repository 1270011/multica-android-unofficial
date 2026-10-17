import { describe, expect, it, vi } from "vitest";

vi.mock("@react-native-community/netinfo", () => ({
  default: { addEventListener: vi.fn(() => () => {}) },
}));

import { isNetworkOffline, useNetworkStore } from "./network-status";

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
