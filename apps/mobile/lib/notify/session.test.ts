// @vitest-environment node
/**
 * Security rule T2: the native session copy is handed
 * over only after a commit and cleared synchronously, before the local
 * teardown continues, on every path that ends a session.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => [] as string[]);
const native = vi.hoisted(() => ({
  enabled: true,
  setCredentials: vi.fn((c: unknown) => {
    calls.push(`set:${JSON.stringify(c)}`);
    return true;
  }),
  clearCredentials: vi.fn(() => {
    calls.push("native-clear");
  }),
  getSettings: vi.fn(() => ({ enabled: native.enabled })),
}));

vi.mock("./native", () => ({
  rbNotify: {
    setCredentials: native.setCredentials,
    clearCredentials: native.clearCredentials,
    getSettings: native.getSettings,
  },
}));

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(async () => null),
  setItemAsync: vi.fn(async () => undefined),
  deleteItemAsync: vi.fn(async (key: string) => {
    calls.push(`keychain-delete:${key}`);
  }),
}));

const serverConfig = vi.hoisted(() => ({
  value: null as null | {
    mode: "cloudflare" | "direct";
    baseUrl: string;
    cfClientId: string;
    cfClientSecret: string;
  },
}));

vi.mock("@/data/server-config-store", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/data/server-config-store")>();
  return { ...real, getServerConfig: () => serverConfig.value };
});

import {
  cfCredentialsChanged,
  clearNotifySession,
  handOverSession,
  renewNotifySessionForConfig,
} from "./session";
import { clearToken } from "@/data/secure-storage";

beforeEach(() => {
  calls.length = 0;
  native.enabled = true;
  native.setCredentials.mockClear();
  native.clearCredentials.mockClear();
  serverConfig.value = {
    mode: "cloudflare",
    baseUrl: "https://multica.example",
    cfClientId: "id.access",
    cfClientSecret: "secret",
  };
});

describe("handOverSession", () => {
  it("passes token and CF headers in cloudflare mode", () => {
    expect(handOverSession("jwt")).toBe(true);
    expect(native.setCredentials).toHaveBeenCalledWith({
      baseUrl: "https://multica.example",
      token: "jwt",
      cfClientId: "id.access",
      cfClientSecret: "secret",
    });
  });

  it("sends no CF headers in direct mode", () => {
    serverConfig.value = { mode: "direct", baseUrl: "https://10.0.0.1", cfClientId: "x", cfClientSecret: "y" };
    handOverSession("jwt");
    expect(native.setCredentials).toHaveBeenCalledWith(
      expect.objectContaining({ cfClientId: "", cfClientSecret: "" }),
    );
  });

  it("does nothing while push is off, without token or without server", () => {
    native.enabled = false;
    expect(handOverSession("jwt")).toBe(false);
    native.enabled = true;
    expect(handOverSession(null)).toBe(false);
    serverConfig.value = null;
    expect(handOverSession("jwt")).toBe(false);
    expect(native.setCredentials).not.toHaveBeenCalled();
  });
});

describe("clearing", () => {
  it("clearNotifySession clears natively", () => {
    clearNotifySession();
    expect(native.clearCredentials).toHaveBeenCalledTimes(1);
  });

  it("clearToken (logout, 401, failed restore) clears the native copy before the keychain", async () => {
    const pending = clearToken();
    // Synchronous part already done, before any await resolved.
    expect(calls[0]).toBe("native-clear");
    await pending;
    expect(calls).toEqual(["native-clear", expect.stringMatching(/^keychain-delete:/)]);
  });

  it("resetting the server configuration clears the native copy", async () => {
    const { useServerConfigStore } = await import("@/data/server-config-store");
    await useServerConfigStore.getState().clear();
    expect(calls[0]).toBe("native-clear");
  });
});

describe("new Cloudflare credentials on the same server", () => {
  const cf = (id: string, secret: string) => ({
    mode: "cloudflare" as const,
    baseUrl: "https://multica.example",
    cfClientId: id,
    cfClientSecret: secret,
  });

  it("detects a changed CF pair only on the same server and mode", () => {
    expect(cfCredentialsChanged(cf("id.access", "secret"), cf("id.access", "new-secret"))).toBe(true);
    expect(cfCredentialsChanged(cf("id.access", "secret"), cf("new.access", "secret"))).toBe(true);
    expect(cfCredentialsChanged(cf("id.access", "secret"), cf("id.access", "secret"))).toBe(false);
    // Other server or mode: the sign-out path handles it.
    expect(cfCredentialsChanged(cf("a", "b"), { ...cf("a", "c"), baseUrl: "https://other.example" })).toBe(false);
    expect(
      cfCredentialsChanged(
        { mode: "direct", baseUrl: "https://multica.example", cfClientId: "", cfClientSecret: "" },
        cf("a", "b"),
      ),
    ).toBe(false);
    expect(cfCredentialsChanged(null, cf("a", "b"))).toBe(false);
  });

  it("clears the native copy first, then hands over with the new headers", () => {
    // The store already holds the saved config when the screen calls this.
    serverConfig.value = cf("id.access", "new-secret");
    expect(renewNotifySessionForConfig(cf("id.access", "secret"), cf("id.access", "new-secret"), "jwt")).toBe(true);
    expect(calls[0]).toBe("native-clear");
    expect(calls[1]).toContain('"cfClientSecret":"new-secret"');
  });

  it("does nothing when the CF pair is unchanged", () => {
    expect(renewNotifySessionForConfig(cf("id.access", "secret"), cf("id.access", "secret"), "jwt")).toBe(false);
    expect(calls).toEqual([]);
  });
});
