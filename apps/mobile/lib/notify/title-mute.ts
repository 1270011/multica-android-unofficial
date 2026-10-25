/**
 * "Also mute push notifications" of the issue title filter (W7).
 *
 * The notifications come from the native foreground service,
 * which runs without JS. So JS decides here whether the stored settings of
 * a workspace allow muting at all, and mirrors only a usable pattern into
 * the native store (`rbNotify.setTitleMute`); the service then matches the
 * issue title itself (modules/rb-notify TitleMute.kt, same limits: pattern
 * ≤ 200, title cut to 300, 10 ms per test, timeout = no mute).
 *
 * Only the title filter mutes. Hidden people and agents (W4) never do:
 * hiding them only tidies the pickers, and a notification you have to act
 * on (blocked, review, mention) must not vanish because of it.
 */
import { titleFilterState } from "../title-filter";
import type { TitleFilterSettings } from "../view-prefs";

export interface TitleMuteConfig {
  pattern: string;
  ignoreCase: boolean;
}

/**
 * The switch can be used only while the title filter is on and its pattern
 * is valid (syntax, length, no nested repetition, not too slow).
 */
export function titleMuteAvailable(settings: TitleFilterSettings): boolean {
  return titleFilterState(settings).status === "active";
}

/** What to mirror into the native store; `null` = this workspace never mutes. */
export function titleMuteConfig(settings: TitleFilterSettings): TitleMuteConfig | null {
  if (!settings.mutePush || !titleMuteAvailable(settings)) return null;
  return { pattern: settings.pattern, ignoreCase: settings.ignoreCase };
}

export function sameTitleMute(a: TitleMuteConfig | null, b: TitleMuteConfig | null): boolean {
  if (a === null || b === null) return a === b;
  return a.pattern === b.pattern && a.ignoreCase === b.ignoreCase;
}

/**
 * Mirrors the per-workspace config into native, calling `push` only for
 * workspaces whose config changed since the last call. Workspaces not
 * hydrated yet are left alone (their earlier native copy stays in force).
 */
export function createTitleMuteMirror(
  push: (workspaceId: string, config: TitleMuteConfig | null) => void,
) {
  const last = new Map<string, TitleMuteConfig | null>();
  return {
    sync(byWorkspace: Readonly<Record<string, TitleFilterSettings>>) {
      for (const [wsId, settings] of Object.entries(byWorkspace)) {
        const next = titleMuteConfig(settings);
        if (last.has(wsId) && sameTitleMute(last.get(wsId) ?? null, next)) continue;
        last.set(wsId, next);
        push(wsId, next);
      }
    },
    /** Logout: the native copy is cleared with the session. */
    reset() {
      last.clear();
    },
  };
}
