/**
 * Mobile auth store — Zustand. Logic mirrors packages/core/auth/store.ts:
 *   - Token written ONLY on successful verifyCode
 *   - 401 → clear token; non-401 (5xx / network blip) → preserve token so
 *     the next launch can retry
 *   - logout = clear token + clear in-memory user + setToken(null) +
 *     forget remembered filters (memory and SecureStore) + clear the
 *     session's caches and stores
 *
 * NOT shared with web/desktop (per Sharing Principles in root CLAUDE.md).
 * Storage backend is expo-secure-store (mobile only); web uses HttpOnly
 * cookies, desktop uses localStorage via StorageAdapter.
 */
import { create } from "zustand";
import type { User } from "@multica/core/types";
import { api, ApiError } from "./api";
import { clearToken, getToken, setToken } from "./secure-storage";
import { currentSessionEpoch, invalidateSessionEpoch, sessionEpochChanged } from "./session-epoch";
import { useWorkspaceStore } from "./workspace-store";
import { handOverSession } from "@/lib/notify/session";
import { useInboxFilterStore } from "./stores/inbox-filter-store";
import { useIssueListFilterStore } from "./stores/issue-list-filter-store";
import { useMyIssuesViewStore } from "@/data/stores/my-issues-view-store";
import { useActiveIssueViewStore } from "@/data/stores/active-issue-view-store";
import { clearAllFilterStorage } from "@/lib/filter-storage";
import { clearSessionData } from "./session-end";
import { openTimelineCache, prefetchTimelineCacheKey } from "./timeline-cache";

interface AuthState {
  user: User | null;
  isLoading: boolean;
  initialize: () => Promise<void>;
  sendCode: (email: string) => Promise<void>;
  verifyCode: (email: string, code: string) => Promise<User>;
  /** Debug builds only (lib/debug-token-login.ts): sign in with an existing
   *  personal access token. Validated against /api/me before it is stored. */
  loginWithToken: (token: string) => Promise<User>;
  logout: () => Promise<void>;
  /** Overwrite the in-memory user — call after PATCH /api/me so name/avatar
   *  edits land without a refetch. Server response is the source of truth. */
  setUser: (user: User) => void;
}

/**
 * Remembered inbox/list filters belong to the signed-in user; the next
 * account on the device must not inherit them. Runs on every way a session
 * ends: logout and a 401 on the launch check.
 */
async function forgetRememberedFilters() {
  useInboxFilterStore.getState().reset();
  useIssueListFilterStore.getState().reset();
  useMyIssuesViewStore.getState().reset();
  useActiveIssueViewStore.getState().reset();
  await clearAllFilterStorage();
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isLoading: true,

  initialize: async () => {
    // Security rule T2: read the epoch before the first await, so a logout
    // during restoreSlug()/getToken()/getMe() is never overwritten.
    const epoch = currentSessionEpoch();
    // Restore the persisted workspace slug alongside the auth token so the
    // entry redirect (app/index.tsx) can route directly to the last-used
    // workspace without flashing /select-workspace.
    await useWorkspaceStore.getState().restoreSlug();

    // The timeline cache key is read next to the token, so the two
    // Keystore reads overlap instead of adding up.
    const [token] = await Promise.all([getToken(), prefetchTimelineCacheKey()]);
    if (!token) {
      set({ isLoading: false });
      return;
    }
    if (sessionEpochChanged(epoch)) {
      set({ isLoading: false });
      return;
    }
    api.setToken(token);
    // A logout while getMe() is in flight must win too; without this check
    // the late answer would restore the user and hand the dead session to
    // the notification service again.
    try {
      const user = await api.getMe();
      if (sessionEpochChanged(epoch)) {
        set({ isLoading: false }); // logout already cleared the user
        return;
      }
      set({ user, isLoading: false });
      // Restored and confirmed: refresh the notification service's copy.
      handOverSession(token);
      void openTimelineCache(user.id);
    } catch (err) {
      // Only clear token on a genuine 401. Network blips / 5xx keep the
      // token so the next launch (or a manual refresh) can retry.
      if (err instanceof ApiError && err.status === 401) {
        // Synchronous first, before the awaited delete: anything already
        // in flight has to learn the credential is dead now, not once the
        // Keychain write lands.
        invalidateSessionEpoch();
        await clearToken();
        api.setToken(null);
        // The session ended without a logout: forget its filters and data
        // too, otherwise the next sign-in inherits them.
        await forgetRememberedFilters();
        clearSessionData();
      }
      set({ user: null, isLoading: false });
    }
  },

  sendCode: async (email) => {
    await api.sendCode(email);
  },

  verifyCode: async (email, code) => {
    const { token, user } = await api.verifyCode(email, code);
    // Signing in replaces the credential just as decisively as signing out:
    // a renewal still in flight for the previous account must not write its
    // result over this one.
    invalidateSessionEpoch();
    const epoch = currentSessionEpoch();
    await setToken(token);
    // A logout during the Keychain write wins (same check as
    // session-renewal): no user, no handover of the dead session.
    if (sessionEpochChanged(epoch)) return user;
    api.setToken(token);
    set({ user });
    handOverSession(token);
    void openTimelineCache(user.id);
    return user;
  },

  loginWithToken: async (token) => {
    const trimmed = token.trim();
    // Probe first: a bad token must not replace a valid stored session.
    const previous = api.getToken();
    api.setToken(trimmed);
    let user: User;
    try {
      user = await api.getMe();
    } catch (err) {
      api.setToken(previous);
      throw err;
    }
    invalidateSessionEpoch();
    await setToken(trimmed);
    api.setToken(trimmed);
    set({ user });
    handOverSession(trimmed);
    void openTimelineCache(user.id);
    return user;
  },

  logout: async () => {
    // First statement in the function, before any await. The Keychain delete
    // below is async, so until it lands a concurrent read still returns the
    // token being removed — the epoch is what makes this instant.
    invalidateSessionEpoch();
    await clearToken();
    api.setToken(null);
    await forgetRememberedFilters();
    // Caches, failed comments, viewed markers, saved route.
    clearSessionData();
    set({ user: null });
  },

  setUser: (user) => set({ user }),
}));
