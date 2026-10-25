/**
 * Typed access to the native operator-notification module
 *Optional lookup: on
 * iOS, in Expo Go or in unit tests the module is missing and every call is a
 * no-op, so callers never branch on the platform themselves.
 *
 * Session functions are synchronous on purpose: `clearCredentials()`
 * has finished deleting the native copy and stopping the service when it
 * returns.
 */
import { createForegroundTracker } from "./foreground";

export type NotifyCategory = "blocked" | "mentions" | "approvals" | "failed_runs" | "assignments";

/** Display order of the switches; "Mir zugewiesen" first. */
export const NOTIFY_CATEGORIES: NotifyCategory[] = [
  "assignments",
  "mentions",
  "blocked",
  "approvals",
  "failed_runs",
];

export interface NotifySettings {
  /** Master switch "Push-Benachrichtigungen". */
  enabled: boolean;
  /** "Hintergrundverbindung": the service runs only when both are on. */
  connectionEnabled: boolean;
  disabledCategories: NotifyCategory[];
  /** "HH:MM" or null (no quiet hours). */
  quietStart: string | null;
  quietEnd: string | null;
  /** Workspace slugs without a background connection. */
  disabledWorkspaces: string[];
}

export interface NotifyStatus {
  running: boolean;
  connected: number;
  notificationsEnabled: boolean;
  permissionGranted: boolean;
  batteryExempt: boolean;
  sdk: number;
}

export interface NotifyCredentials {
  baseUrl: string;
  token: string;
  cfClientId: string;
  cfClientSecret: string;
}

export interface NotifyWorkspace {
  id: string;
  slug: string;
  name: string;
  enabled: boolean;
}

interface RbNotifyNative {
  setCredentials(c: NotifyCredentials): boolean;
  clearCredentials(): void;
  hasCredentials(): boolean;
  setWorkspaces(list: NotifyWorkspace[]): void;
  setSettings(s: NotifySettings): void;
  getSettings(): NotifySettings;
  setStrings(map: Record<string, string>): void;
  setActors(map: Record<string, string>): void;
  /** Title filter push mute of one workspace (W7); `pattern` null = off. */
  setTitleMute(workspaceId: string, pattern: string | null, ignoreCase: boolean): void;
  /** `dismiss`: also remove the issue's notification (in-app or own-notification open only, B5). */
  setForegroundIssue(issueId: string | null, dismiss: boolean): void;
  start(): boolean;
  stop(): void;
  getStatus(): NotifyStatus;
  consumeNonce(nonce: string, issueId: string): boolean;
  requestIgnoreBatteryOptimizations(): boolean;
  openNotificationSettings(channelId: string | null): void;
  debugNotify(slug: string, issueId: string, title: string): boolean;
}

// Same lookup as expo's requireOptionalNativeModule, without importing the
// expo runtime — keeps this file (and secure-storage.ts, which clears the
// session through it) loadable in the Node unit-test lane.
const native: RbNotifyNative | null =
  (globalThis as { expo?: { modules?: Record<string, unknown> } }).expo?.modules?.RbNotify as
    | RbNotifyNative
    | undefined ?? null;

export const notifyAvailable = native !== null;

export const DEFAULT_SETTINGS: NotifySettings = {
  enabled: false,
  connectionEnabled: true,
  disabledCategories: [],
  quietStart: null,
  quietEnd: null,
  disabledWorkspaces: [],
};

function safe<T>(fallback: T, run: (m: RbNotifyNative) => T): T {
  if (!native) return fallback;
  try {
    return run(native);
  } catch {
    return fallback;
  }
}

const foreground = createForegroundTracker({
  setForegroundIssue: (id, dismiss) => safe(undefined, (m) => m.setForegroundIssue(id, dismiss)),
});

export const rbNotify = {
  setCredentials: (c: NotifyCredentials) => safe(false, (m) => m.setCredentials(c)),
  // Not wrapped in `safe`: a failing clear must surface, never pass silently.
  clearCredentials: () => {
    native?.clearCredentials();
  },
  hasCredentials: () => safe(false, (m) => m.hasCredentials()),
  setWorkspaces: (list: NotifyWorkspace[]) => safe(undefined, (m) => m.setWorkspaces(list)),
  setSettings: (s: NotifySettings) => safe(undefined, (m) => m.setSettings(s)),
  getSettings: (): NotifySettings =>
    safe(DEFAULT_SETTINGS, (m) => ({ ...DEFAULT_SETTINGS, ...m.getSettings() })),
  setStrings: (map: Record<string, string>) => safe(undefined, (m) => m.setStrings(map)),
  setActors: (map: Record<string, string>) => safe(undefined, (m) => m.setActors(map)),
  setTitleMute: (workspaceId: string, config: { pattern: string; ignoreCase: boolean } | null) =>
    safe(undefined, (m) =>
      m.setTitleMute(workspaceId, config?.pattern ?? null, config?.ignoreCase ?? false),
    ),
  /** Chat on screen; `dismiss` only for in-app / own-notification opens (B5). */
  setForegroundIssue: (id: string, dismiss = false) => foreground.set(id, dismiss),
  /** Chat left: clears only if it is still the current one. */
  clearForegroundIssue: (id: string) => foreground.clear(id),
  pauseForegroundIssue: () => foreground.pause(),
  resumeForegroundIssue: () => foreground.resume(),
  start: () => safe(false, (m) => m.start()),
  stop: () => safe(undefined, (m) => m.stop()),
  getStatus: (): NotifyStatus | null => safe(null, (m) => m.getStatus()),
  consumeNonce: (nonce: string, issueId: string) =>
    safe(false, (m) => m.consumeNonce(nonce, issueId)),
  requestIgnoreBatteryOptimizations: () =>
    safe(false, (m) => m.requestIgnoreBatteryOptimizations()),
  openNotificationSettings: (channelId: string | null = null) =>
    safe(undefined, (m) => m.openNotificationSettings(channelId)),
  debugNotify: (slug: string, issueId: string, title: string) =>
    safe(false, (m) => m.debugNotify(slug, issueId, title)),
};
