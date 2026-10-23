/**
 * Pure helpers of the "Push auf diesem Gerät" settings and the permission
 * card. No React, no native calls —
 * unit-tested in push-logic.test.ts.
 */
import type { NotificationGroupKey, NotificationPreferences } from "@multica/core/types";
import type { NotifyCategory, NotifySettings } from "./native";

/** Server inbox group that has to be on for a category to produce entries. */
export const SERVER_GROUP: Record<NotifyCategory, NotificationGroupKey> = {
  blocked: "status_changes",
  approvals: "status_changes",
  mentions: "mentions",
  failed_runs: "agent_activity",
  assignments: "assignments",
};

export function mutedServerGroup(
  category: NotifyCategory,
  prefs: NotificationPreferences | undefined,
): NotificationGroupKey | null {
  const group = SERVER_GROUP[category];
  return prefs?.[group] === "muted" ? group : null;
}

export function setCategory(
  settings: NotifySettings,
  category: NotifyCategory,
  on: boolean,
): NotifySettings {
  const rest = settings.disabledCategories.filter((c) => c !== category);
  return { ...settings, disabledCategories: on ? rest : [...rest, category] };
}

/**
 * Categories whose switch also turns the server group back on:
 * switching "Mir zugewiesen" on while `assignments` is muted would
 * otherwise stay silent, because the server creates no inbox entry at all.
 */
export const COUPLED_CATEGORIES: readonly NotifyCategory[] = ["assignments"];

/**
 * Category switch flipped: new device settings plus, when the coupling
 * applies, the server preferences to PATCH (null = no server write).
 */
export function toggleCategory(
  settings: NotifySettings,
  category: NotifyCategory,
  on: boolean,
  serverPrefs: NotificationPreferences | undefined,
): { settings: NotifySettings; serverPrefs: NotificationPreferences | null } {
  const next = setCategory(settings, category, on);
  const muted = mutedServerGroup(category, serverPrefs);
  if (!on || !muted || !COUPLED_CATEGORIES.includes(category)) {
    return { settings: next, serverPrefs: null };
  }
  const prefs: NotificationPreferences = { ...(serverPrefs ?? {}) };
  // Missing key = "all"; the mutation turns this into {[muted]: "all"}.
  delete prefs[muted];
  return { settings: next, serverPrefs: prefs };
}

/** Apply a toggle: device settings always, server PATCH only when coupled. */
export function applyCategoryToggle(
  input: {
    settings: NotifySettings;
    category: NotifyCategory;
    on: boolean;
    serverPrefs: NotificationPreferences | undefined;
  },
  deps: {
    update: (settings: NotifySettings) => void;
    patchServer: (prefs: NotificationPreferences) => void;
  },
): void {
  const result = toggleCategory(input.settings, input.category, input.on, input.serverPrefs);
  deps.update(result.settings);
  if (result.serverPrefs) deps.patchServer(result.serverPrefs);
}

export function setWorkspaceEnabled(
  settings: NotifySettings,
  slug: string,
  on: boolean,
): NotifySettings {
  const rest = settings.disabledWorkspaces.filter((s) => s !== slug);
  return { ...settings, disabledWorkspaces: on ? rest : [...rest, slug] };
}

export const DEFAULT_QUIET = { start: "22:00", end: "07:00" } as const;

export function setQuietHours(
  settings: NotifySettings,
  quiet: { start: string; end: string } | null,
): NotifySettings {
  return { ...settings, quietStart: quiet?.start ?? null, quietEnd: quiet?.end ?? null };
}

export function hhmm(date: Date): string {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export function dateFromHhmm(value: string, base: Date = new Date()): Date {
  const [h, m] = value.split(":").map(Number);
  const d = new Date(base);
  d.setHours(h ?? 0, m ?? 0, 0, 0);
  return d;
}

// ── Permission card ────────────────────────────────────────────

export interface CardState {
  /** Card finished: enabled, denied, or second "later". */
  done: boolean;
  laterCount: number;
  /** Epoch ms until which a "later" hides the card. */
  hiddenUntil: number;
}

export const INITIAL_CARD: CardState = { done: false, laterCount: 0, hiddenUntil: 0 };
export const LATER_MS = 7 * 24 * 60 * 60 * 1000;

export function shouldShowCard(
  state: CardState,
  ctx: { available: boolean; enabled: boolean; now: number },
): boolean {
  if (!ctx.available || ctx.enabled) return false;
  if (state.done) return false;
  return ctx.now >= state.hiddenUntil;
}

/** "Later": 7 days; the second "later" retires the card for good. */
export function afterLater(state: CardState, now: number): CardState {
  const laterCount = state.laterCount + 1;
  return { done: laterCount >= 2, laterCount, hiddenUntil: now + LATER_MS };
}

export function afterDecision(state: CardState): CardState {
  return { ...state, done: true };
}

export function parseCardState(raw: string | null): CardState {
  if (!raw) return INITIAL_CARD;
  try {
    const o = JSON.parse(raw) as Partial<CardState>;
    return {
      done: o.done === true,
      laterCount: typeof o.laterCount === "number" ? o.laterCount : 0,
      hiddenUntil: typeof o.hiddenUntil === "number" ? o.hiddenUntil : 0,
    };
  } catch {
    return INITIAL_CARD;
  }
}

// ── Strings for the native side ──────────────────────────────────────────

/** Keys the native Notifier reads (Notifier.kt / NotifyPrefs.string). */
export const NATIVE_STRING_KEYS: Record<string, string> = {
  channel_blocked: "settings:push.channel_blocked",
  channel_mentions: "settings:push.channel_mentions",
  channel_approvals: "settings:push.channel_approvals",
  channel_assignments: "settings:push.channel_assignments",
  channel_quiet: "settings:push.channel_quiet",
  channel_connection: "settings:push.channel_connection",
  connection_on: "settings:push.connection_on",
  connection_on_many: "settings:push.connection_on_many",
  connection_wait: "settings:push.connection_wait",
  connection_refused: "settings:push.connection_refused",
  reason_blocked: "settings:push.reason_blocked",
  reason_mention: "settings:push.reason_mention",
  reason_approval: "settings:push.reason_approval",
  reason_failed: "settings:push.reason_failed",
  reason_assigned: "settings:push.reason_assigned",
  title_assigned: "settings:push.title_assigned",
  line_assigned: "settings:push.line_assigned",
  line_assigned_unknown: "settings:push.line_assigned_unknown",
  line_blocked: "settings:push.line_blocked",
  line_review: "settings:push.line_review",
  summary_title: "settings:push.summary_title",
  summary_title_single: "settings:push.summary_title_single",
  summary_older: "settings:push.summary_older",
  summary_older_only: "settings:push.summary_older_only",
  summary_older_only_single: "settings:push.summary_older_only_single",
  public_title: "settings:push.public_title",
  action_mark_read: "settings:push.action_mark_read",
  relogin_title: "settings:push.relogin_title",
  relogin_text: "settings:push.relogin_text",
  no_workspace_text: "settings:push.no_workspace_text",
  me: "settings:push.me",
};

export function buildNativeStrings(
  t: (key: string, options?: Record<string, unknown>) => string,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [nativeKey, i18nKey] of Object.entries(NATIVE_STRING_KEYS)) {
    // `{count}` stays a literal placeholder; the native side fills it in.
    out[nativeKey] = t(i18nKey, { count: "{count}" });
  }
  return out;
}
