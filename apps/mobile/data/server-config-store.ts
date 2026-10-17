/**
 * Server connection store — Zustand + expo-secure-store.
 *
 * Holds the connection mode, base URL and (in Cloudflare mode) the Access
 * service token. Persisted in the Android Keystore-backed SecureStore, never
 * in the bundle. `ApiClient`, the realtime provider and the image helpers
 * read it synchronously through the getters at the bottom, the same way
 * `workspace-store.ts` exposes `getCurrentSlug()`.
 *
 * Lifecycle:
 *   - `load()` runs once at app start (app/_layout.tsx) before auth
 *     initialises, so the first `getMe()` already has a base URL.
 *   - `save()` validates nothing — callers go through
 *     `validateServerConfig()` first and hand over a normalised config.
 *   - `clear()` wipes every field (Settings → "Forget server").
 *
 * Changing the server invalidates the session: the bearer token belongs to
 * the old origin. The setup screen signs out when the base URL changes.
 */
import { create } from "zustand";
import * as SecureStore from "expo-secure-store";

import type { ConnectionMode, ServerConfig } from "@/lib/server-config";
import { cfAccessHeaders } from "@/lib/server-config";
import { clearNotifySession } from "@/lib/notify/session";

const KEY_MODE = "rb_server_mode";
const KEY_URL = "rb_server_url";
const KEY_CF_ID = "rb_cf_client_id";
const KEY_CF_SECRET = "rb_cf_client_secret";

interface ServerConfigState {
  config: ServerConfig | null;
  /** False until `load()` has read SecureStore once. */
  isLoaded: boolean;
  load: () => Promise<ServerConfig | null>;
  save: (config: ServerConfig) => Promise<void>;
  clear: () => Promise<void>;
}

function parseMode(value: string | null): ConnectionMode | null {
  return value === "cloudflare" || value === "direct" ? value : null;
}

export const useServerConfigStore = create<ServerConfigState>((set) => ({
  config: null,
  isLoaded: false,

  load: async () => {
    try {
      const [mode, url, cfId, cfSecret] = await Promise.all([
        SecureStore.getItemAsync(KEY_MODE),
        SecureStore.getItemAsync(KEY_URL),
        SecureStore.getItemAsync(KEY_CF_ID),
        SecureStore.getItemAsync(KEY_CF_SECRET),
      ]);
      const parsedMode = parseMode(mode);
      if (!parsedMode || !url) {
        set({ config: null, isLoaded: true });
        return null;
      }
      const config: ServerConfig = {
        mode: parsedMode,
        baseUrl: url,
        cfClientId: parsedMode === "cloudflare" ? (cfId ?? "") : "",
        cfClientSecret: parsedMode === "cloudflare" ? (cfSecret ?? "") : "",
      };
      set({ config, isLoaded: true });
      return config;
    } catch {
      // A SecureStore read failure must not wedge the app on the spinner —
      // fall through to the setup screen.
      set({ config: null, isLoaded: true });
      return null;
    }
  },

  save: async (config) => {
    set({ config, isLoaded: true });
    await SecureStore.setItemAsync(KEY_MODE, config.mode);
    await SecureStore.setItemAsync(KEY_URL, config.baseUrl);
    if (config.mode === "cloudflare") {
      await SecureStore.setItemAsync(KEY_CF_ID, config.cfClientId);
      await SecureStore.setItemAsync(KEY_CF_SECRET, config.cfClientSecret);
    } else {
      await SecureStore.deleteItemAsync(KEY_CF_ID);
      await SecureStore.deleteItemAsync(KEY_CF_SECRET);
    }
  },

  clear: async () => {
    // T2: resetting the server drops the notification session synchronously.
    clearNotifySession();
    set({ config: null, isLoaded: true });
    await Promise.all([
      SecureStore.deleteItemAsync(KEY_MODE),
      SecureStore.deleteItemAsync(KEY_URL),
      SecureStore.deleteItemAsync(KEY_CF_ID),
      SecureStore.deleteItemAsync(KEY_CF_SECRET),
    ]);
  },
}));

/** Sync read for non-React callers (ApiClient, WS provider, image helpers). */
export function getServerConfig(): ServerConfig | null {
  return useServerConfigStore.getState().config;
}

/** Configured base URL, or null when the app has not been set up yet. */
export function getServerBaseUrl(): string | null {
  return getServerConfig()?.baseUrl ?? null;
}

/**
 * Base URL of the web UI = the configured server origin (self-hosted
 * Multica serves web and API from one origin). See lib/web-links.ts.
 */
export function getWebBaseUrl(): string | null {
  return getServerBaseUrl();
}

/** Cloudflare Access headers for requests to the configured server. */
export function getCfAccessHeaders(): Record<string, string> {
  return cfAccessHeaders(getServerConfig());
}
