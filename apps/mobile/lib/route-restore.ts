/**
 * Bring the user back to the screen they were on after Android recreated
 * the Activity.
 *
 * Two halves:
 *   - While the app runs, the root layout calls `rememberRoute(pathname)`
 *     on every route change; the path lands in a small file in the app's
 *     private files dir.
 *   - `plugins/with-android-restore-route.js` makes MainActivity write a
 *     marker file when it is recreated with saved instance state. On the
 *     next JS start `consumeRestoredRoute()` finds the marker, deletes it
 *     and returns the saved path; `app/index.tsx` redirects there instead
 *     of the Inbox. Without the marker (normal cold start, swipe-away) the
 *     saved path is ignored, so launches still land on the Inbox.
 *
 * Only workspace routes are restored (`resolveRestorePath`); the auth and
 * setup screens already redirect on their own. `anchor: "(tabs)"` in the
 * workspace layout puts the tab UI under a restored deep route, so Back
 * works as before. Both paths go through `openRestoredRoute`, which builds
 * the stack explicitly (Inbox tab, then the restored screen).
 * Before, Back from a restored screen landed on the workspace selection, and `withAnchor` alone did not help
 * after a font-size change.
 */
import { File, Paths } from "expo-file-system";

export const ROUTE_FILE = "last-route.json";
export const MARKER_FILE = "restore-route-marker";

export function resolveRestorePath(pathname: string | null | undefined): string | null {
  if (!pathname || pathname === "/") return null;
  for (const prefix of ["/login", "/verify", "/server-setup", "/token-login", "/select-workspace"]) {
    if (pathname.startsWith(prefix)) return null;
  }
  return pathname;
}

export function rememberRoute(pathname: string | null | undefined): void {
  const path = resolveRestorePath(pathname);
  if (!path) return;
  try {
    new File(Paths.document, ROUTE_FILE).write(JSON.stringify({ path, at: Date.now() }));
  } catch {
    // Best effort — losing the restore is not worth a crash.
  }
}

/** Only routes of the current workspace are restored. */
export function restoreTarget(restored: string | null, slug: string | null | undefined): string | null {
  return restored && slug && restored.startsWith(`/${slug}/`) ? restored : null;
}

export interface RestoreNavigator {
  replace(href: string): void;
  push(href: string): void;
}

/** Tab roots of a workspace; restoring one of them needs no extra screen. */
const TAB_ROOTS = ["inbox", "my-issues", "chat", "more"];

/** Gap between "tab" and "push the restored screen", so the tab stack exists. */
export const RESTORE_PUSH_DELAY_MS = 250;

/**
 * Open a restored route with a real back stack (M4). `withAnchor` did not
 * put the tabs under a restored detail after a font-size change (smoke
 * test no back arrow, Back left the app), so the stack is built
 * explicitly: replace with the Inbox tab, then push the restored screen.
 * Back from the detail always lands on the Inbox. Used by the cold path
 * (app/index.tsx) and the warm path (app/_layout.tsx).
 */
export function openRestoredRoute(
  nav: RestoreNavigator,
  restored: string | null,
  slug: string | null | undefined,
  schedule: (run: () => void, ms: number) => void = (run, ms) => {
    setTimeout(run, ms);
  },
): boolean {
  const target = restoreTarget(restored, slug);
  if (!target) return false;
  const rest = target.slice(`/${slug}/`.length).split(/[/?#]/)[0] ?? "";
  if (TAB_ROOTS.includes(rest) && !target.slice(`/${slug}/${rest}`.length).replace(/^\//, "")) {
    nav.replace(target);
    return true;
  }
  nav.replace(`/${slug}/inbox`);
  // Not cancelled on unmount: the caller (index) goes away with the replace.
  schedule(() => nav.push(target), RESTORE_PUSH_DELAY_MS);
  return true;
}

/** Reads and clears the recreation marker; returns the route to restore. */
/**
 * Session end: the saved route names an issue
 * of the old account, so it goes with the session, the marker too.
 */
export function forgetRememberedRoute(): void {
  for (const name of [ROUTE_FILE, MARKER_FILE]) {
    try {
      const file = new File(Paths.document, name);
      if (file.exists) file.delete();
    } catch {
      // Best effort, like rememberRoute.
    }
  }
}

export function consumeRestoredRoute(): string | null {
  try {
    const marker = new File(Paths.document, MARKER_FILE);
    if (!marker.exists) return null;
    marker.delete();
    const saved = new File(Paths.document, ROUTE_FILE);
    if (!saved.exists) return null;
    const parsed = JSON.parse(saved.textSync()) as { path?: unknown };
    return typeof parsed.path === "string" ? resolveRestorePath(parsed.path) : null;
  } catch {
    return null;
  }
}
